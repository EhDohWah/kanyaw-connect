<?php

use App\Enums\PushOutcome;
use App\Jobs\RetryWebPush;
use App\Models\Call;
use App\Models\ChatMember;
use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\Channels\WebPushChannel;
use App\Notifications\IncomingCallNotification;
use App\Services\PresenceService;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\URL;

beforeEach(function () {
    fakeLiveKit();
    fakeBroadcasts();
    $this->push = fakeWebPush();
    $this->caller = User::factory()->create(['name' => 'Naw Paw']);
    $this->callee = User::factory()->create(['name' => 'Saw Htoo']);
    PushSubscription::factory()->count(2)->create(['user_id' => $this->callee->id]);
    PushSubscription::factory()->create(['user_id' => $this->caller->id]);
    $this->chat = makeDirect($this->caller, $this->callee);
});

function startCall($test, $caller, $chat, string $kind = 'video'): Call
{
    signIn($caller);
    $test->postJson("/api/v1/chats/{$chat->id}/calls", ['kind' => $kind])->assertCreated();

    return Call::latest()->first();
}

/** @return list<array<string, mixed>> the payloads of one type pushed to a user */
function pushesOfType($push, User $user, string $type): array
{
    return array_values(array_filter($push->sentTo($user), fn (array $sent) => $sent['payload']['type'] === $type));
}

describe('the incoming-call push', function () {
    it('rings every browser of the callee, with the call and a decline link', function () {
        $this->freezeTime();
        $call = startCall($this, $this->caller, $this->chat, 'voice');

        $pushes = pushesOfType($this->push, $this->callee, 'call.incoming');
        expect($pushes)->toHaveCount(2);

        $payload = $pushes[0]['payload'];
        expect(array_keys($payload))->toBe(['type', 'call_id', 'chat_id', 'room_id', 'kind', 'title', 'body', 'icon', 'decline_url', 'ring_expires_at'])
            ->and($payload)->toMatchArray([
                'type' => 'call.incoming',
                'call_id' => $call->id,
                'chat_id' => $this->chat->id,
                'room_id' => $call->room_id,
                'kind' => 'voice',
                'title' => 'Naw Paw',
                'body' => 'Incoming voice call',
                'icon' => null,
                'ring_expires_at' => now()->addSeconds(45)->toJSON(),
            ])
            ->and($payload['decline_url'])->toStartWith(url("/api/v1/calls/{$call->id}/decline?expires="));
    });

    it('says "Incoming video call" and shows the caller\'s photo', function () {
        $this->caller->forceFill(['avatar_path' => 'avatars/naw.webp'])->save();

        startCall($this, $this->caller, $this->chat, 'video');

        $payload = pushesOfType($this->push, $this->callee, 'call.incoming')[0]['payload'];
        expect($payload['body'])->toBe('Incoming video call')
            ->and($payload['icon'])->toBe($this->caller->fresh()->avatar_thumb_url)->not->toBeNull();
    });

    it('is urgent and expires when the ringing does', function () {
        startCall($this, $this->caller, $this->chat);

        $options = pushesOfType($this->push, $this->callee, 'call.incoming')[0]['options'];
        expect($options['urgency'])->toBe('high')
            ->and($options['ttl'])->toBeGreaterThanOrEqual(44)->toBeLessThanOrEqual(45)
            ->and($options)->not->toHaveKey('retry');
    });

    it('gives the push service only the seconds that are left when it is sent late', function () {
        $call = makeCall($this->caller, $this->callee);
        $notification = IncomingCallNotification::forCall($call->load('caller'));

        $this->travel(30)->seconds();

        expect($notification->webPushOptions()['ttl'])->toBeGreaterThanOrEqual(14)->toBeLessThanOrEqual(15);
    });

    it('rings even while the callee\'s app is open, and even in a muted chat', function () {
        app(PresenceService::class)->heartbeat($this->callee);
        ChatMember::where('chat_id', $this->chat->id)->where('user_id', $this->callee->id)->update(['is_muted' => true]);

        startCall($this, $this->caller, $this->chat);

        expect(pushesOfType($this->push, $this->callee, 'call.incoming'))->toHaveCount(2);
    });

    it('never goes to the caller, and sends no "new message" push', function () {
        startCall($this, $this->caller, $this->chat);

        expect($this->push->notifiedUserIds())->toBe([$this->callee->id])
            ->and(pushesOfType($this->push, $this->callee, 'message.new'))->toBe([]);
    });

    it('is not retried: a late ring is no use', function () {
        Queue::fake([RetryWebPush::class]);
        $endpoint = PushSubscription::where('user_id', $this->callee->id)->value('endpoint');
        $this->push->outcomes[$endpoint] = PushOutcome::Failed;

        startCall($this, $this->caller, $this->chat);

        Queue::assertNotPushed(RetryWebPush::class);
    });

    it('is not sent if the call stopped ringing while it waited in the queue', function (string $status) {
        $call = makeCall($this->caller, $this->callee);
        $notification = IncomingCallNotification::forCall($call->load('caller'));

        $call->update(['status' => $status]);

        expect($notification->shouldSend($this->callee, WebPushChannel::class))->toBeFalse();
    })->with(['ongoing', 'declined', 'missed']);

    it('is not sent once the ringing has run out', function () {
        $call = makeCall($this->caller, $this->callee);
        $notification = IncomingCallNotification::forCall($call->load('caller'));

        expect($notification->shouldSend($this->callee, WebPushChannel::class))->toBeTrue();
        $this->travelTo($call->ring_expires_at->addSecond());
        expect($notification->shouldSend($this->callee, WebPushChannel::class))->toBeFalse();
    });

    it('carries a decline link that the service worker can use without a token', function () {
        $call = startCall($this, $this->caller, $this->chat);
        $url = pushesOfType($this->push, $this->callee, 'call.incoming')[0]['payload']['decline_url'];
        app('auth')->forgetGuards();

        $this->postJson($url, [], ['Authorization' => ''])->assertOk()->assertJsonPath('data.status', 'declined');
        expect($call->fresh()->status->value)->toBe('declined');
    });

    it('is not sent when push is not set up', function () {
        $this->push->configured = false;

        startCall($this, $this->caller, $this->chat);

        expect($this->push->sent)->toBe([]);
    });

    it('signs the decline link for exactly the ringing time', function () {
        $call = makeCall($this->caller, $this->callee);

        $url = IncomingCallNotification::forCall($call->load('caller'))->payload['decline_url'];

        expect($url)->toBe(URL::temporarySignedRoute('calls.decline', $call->ring_expires_at, $call))
            ->and($url)->toContain('expires='.$call->ring_expires_at->timestamp);
    });
});

describe('the missed-call push', function () {
    it('tells the callee when the caller gives up', function () {
        $call = startCall($this, $this->caller, $this->chat, 'voice');
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        $pushes = pushesOfType($this->push, $this->callee, 'call.missed');
        expect($pushes)->toHaveCount(2)
            ->and($pushes[0]['payload'])->toBe([
                'type' => 'call.missed',
                'call_id' => $call->id,
                'chat_id' => $this->chat->id,
                'kind' => 'voice',
                'title' => 'Naw Paw',
                'body' => 'Missed voice call',
            ])
            ->and($pushes[0]['options'])->toBe([]);
    });

    it('tells the callee when nobody answered', function () {
        $call = makeCall($this->caller, $this->callee);
        $this->travelTo($call->ring_expires_at->addSecond());
        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(pushesOfType($this->push, $this->callee, 'call.missed'))->toHaveCount(2)
            ->and(pushesOfType($this->push, $this->callee, 'call.missed')[0]['payload']['body'])->toBe('Missed video call');
    });

    it('follows the rules of message pushes: not while their app is open, not in a muted chat', function (string $case) {
        $call = makeCall($this->caller, $this->callee);
        match ($case) {
            'online' => app(PresenceService::class)->heartbeat($this->callee),
            'muted' => ChatMember::where('chat_id', $this->chat->id)->where('user_id', $this->callee->id)->update(['is_muted' => true]),
        };

        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        expect(pushesOfType($this->push, $this->callee, 'call.missed'))->toBe([]);
    })->with(['online', 'muted']);

    it('is never sent to the caller, nor for a declined or answered call', function () {
        $declined = makeCall($this->caller, $this->callee);
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$declined->id}/decline")->assertOk();
        $answered = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        $this->postJson("/api/v1/calls/{$answered->id}/end")->assertOk();

        expect($this->push->sent)->toBe([]);
    });
});
