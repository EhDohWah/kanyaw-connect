<?php

use App\Actions\Push\NotifyMessageRecipients;
use App\Enums\PushOutcome;
use App\Jobs\RetryNativePush;
use App\Models\ChatMember;
use App\Models\NativePushToken;
use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\Channels\NativePushChannel;
use App\Notifications\Channels\WebPushChannel;
use App\Services\NativePush\ApnsMessage;
use App\Services\PresenceService;
use Illuminate\Notifications\SendQueuedNotifications;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->web = fakeWebPush();
    $this->native = fakeNativePush();
    $this->sender = signIn(User::factory()->create(['name' => 'Saw Eh Doh']));
    config(['app.name' => 'Kanyaw Connect']);
});

/** A user signed in on phones: Android unless 'ios' is asked for. */
function withPhones(string ...$platforms): User
{
    $user = User::factory()->create();

    foreach ($platforms ?: ['android'] as $platform) {
        $platform === 'ios'
            ? NativePushToken::factory()->ios()->create(['user_id' => $user->id])
            : NativePushToken::factory()->create(['user_id' => $user->id]);
    }

    return $user;
}

function tokenOf(User $user, string $platform = 'android'): NativePushToken
{
    return NativePushToken::where('user_id', $user->id)->where('platform', $platform)->firstOrFail();
}

function sayNative($test, $chat, string $text)
{
    return $test->postJson("/api/v1/chats/{$chat->id}/messages", [
        'client_id' => (string) Str::uuid(),
        'type' => 'text',
        'content' => $text,
    ]);
}

describe('on Android', function () {
    it('is a notification on the "messages" channel, urgent, living as long as a web push', function () {
        $friend = withPhones('android');
        $chat = makeDirect($this->sender, $friend);

        sayNative($this, $chat, 'Are you coming on Saturday?')->assertCreated();

        $sent = $this->native->to(tokenOf($friend)->token);
        expect($sent)->toHaveCount(1);
        $message = $sent[0]->toArray();
        expect($message['notification'])->toBe(['title' => 'Saw Eh Doh', 'body' => 'Are you coming on Saturday?'])
            ->and($message['android'])->toBe(['priority' => 'HIGH', 'ttl' => config('push.ttl_seconds').'s', 'notification' => ['channel_id' => 'messages']])
            ->and($message['data'])->toMatchArray([
                'type' => 'message.new',
                'chat_id' => $chat->id,
                'encrypted' => 'false',
                'message_type' => 'text',
            ])
            ->and($message['data'])->not->toHaveKeys(['title', 'body'])
            ->and(array_filter($message['data'], fn ($value) => ! is_string($value)))->toBe([]);
    });
});

describe('on iOS', function () {
    it('is an APNs alert to the device token, grouped by chat', function () {
        $this->freezeTime();
        $friend = withPhones('ios');
        $chat = makeDirect($this->sender, $friend);

        sayNative($this, $chat, 'Hello')->assertCreated();

        $registration = tokenOf($friend, 'ios');
        $sent = $this->native->apns();
        expect($sent)->toHaveCount(1)
            ->and($this->native->to($registration->voip_token))->toBe([]);

        $message = $sent[0];
        expect($message->deviceToken)->toBe($registration->token)
            ->and($message->headers())->toMatchArray([
                'apns-push-type' => 'alert',
                'apns-topic' => 'org.example.kanyawconnect',
                'apns-priority' => '10',
                'apns-expiration' => (string) now()->addSeconds(config('push.ttl_seconds'))->getTimestamp(),
            ])
            ->and($message->payload['aps'])->toBe([
                'alert' => ['title' => 'Saw Eh Doh', 'body' => 'Hello'],
                'sound' => 'default',
                'thread-id' => $chat->id,
            ])
            ->and($message->payload)->toMatchArray(['type' => 'message.new', 'chat_id' => $chat->id]);
    });
});

describe('who is notified', function () {
    it('reaches every phone a person is signed in to', function () {
        $friend = withPhones('android', 'android', 'ios');

        sayNative($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        expect($this->native->fcm())->toHaveCount(2)
            ->and($this->native->apns(ApnsMessage::ALERT))->toHaveCount(1);
    });

    it('reaches a person with only a phone, even when web push is not set up', function () {
        $this->web->configured = false;
        $friend = withPhones();

        sayNative($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        expect($this->native->sent)->toHaveCount(1);
    });

    it('sends to both the browsers and the phones of a person who has both', function () {
        $friend = withPhones();
        PushSubscription::factory()->create(['user_id' => $friend->id]);

        sayNative($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        expect($this->native->sent)->toHaveCount(1)
            ->and($this->web->sentTo($friend))->toHaveCount(1);
    });

    it('never pushes to the sender\'s own phones', function () {
        NativePushToken::factory()->create(['user_id' => $this->sender->id]);
        $friend = withPhones();

        sayNative($this, makeGroup($this->sender, [$friend]), 'Hi')->assertCreated();

        expect($this->native->to(tokenOf($this->sender)->token))->toBe([])
            ->and($this->native->sent)->toHaveCount(1);
    });

    it('skips people who muted the chat', function () {
        [$muted, $listening] = [withPhones(), withPhones()];
        $chat = makeGroup($this->sender, [$muted, $listening]);
        ChatMember::where('chat_id', $chat->id)->where('user_id', $muted->id)->update(['is_muted' => true]);

        sayNative($this, $chat, 'Hi')->assertCreated();

        expect($this->native->to(tokenOf($muted)->token))->toBe([])
            ->and($this->native->to(tokenOf($listening)->token))->toHaveCount(1);
    });

    it('skips people whose app is open right now', function () {
        [$online, $offline] = [withPhones(), withPhones()];
        app(PresenceService::class)->heartbeat($online);

        sayNative($this, makeGroup($this->sender, [$online, $offline]), 'Hi')->assertCreated();

        expect($this->native->to(tokenOf($online)->token))->toBe([])
            ->and($this->native->to(tokenOf($offline)->token))->toHaveCount(1);
    });

    it('says only "New message" for an encrypted chat', function () {
        $friend = withPhones('android', 'ios');
        $chat = makeEncryptedGroup($this->sender, [$friend]);

        app(NotifyMessageRecipients::class)->handle(addMessage($chat, $this->sender, ['content' => null]));

        $android = $this->native->fcm()[0]->toArray();
        $ios = $this->native->apns()[0]->payload;
        expect($android['notification'])->toBe(['title' => 'Kanyaw Connect', 'body' => 'New message'])
            ->and($android['data']['encrypted'])->toBe('true')
            ->and($android['data'])->not->toHaveKey('message_type')
            ->and($ios['aps']['alert'])->toBe(['title' => 'Kanyaw Connect', 'body' => 'New message']);
    });
});

describe('delivery', function () {
    it('queues one job per channel that can reach the person, and none for a channel that cannot', function () {
        Queue::fake([SendQueuedNotifications::class]);
        $phoneOnly = withPhones();
        $both = withPhones();
        PushSubscription::factory()->create(['user_id' => $both->id]);

        sayNative($this, makeGroup($this->sender, [$phoneOnly, $both]), 'Hi')->assertCreated();

        $jobs = Queue::pushed(SendQueuedNotifications::class)->map(fn ($job) => [$job->notifiables->first()->id, $job->channels[0]]);
        expect($jobs->all())->toEqualCanonicalizing([
            [$phoneOnly->id, NativePushChannel::class],
            [$both->id, NativePushChannel::class],
            [$both->id, WebPushChannel::class],
        ]);
    });

    it('forgets a phone whose token the push service says is dead', function () {
        $friend = withPhones('android', 'ios');
        $dead = tokenOf($friend);
        $this->native->outcomes[$dead->token] = PushOutcome::Expired;

        sayNative($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        expect(NativePushToken::find($dead->id))->toBeNull()
            ->and(tokenOf($friend, 'ios')->exists)->toBeTrue();
    });

    it('tries again later when the push service had a problem', function () {
        Queue::fake([RetryNativePush::class]);
        $friend = withPhones();
        $this->native->outcomes[tokenOf($friend)->token] = PushOutcome::Failed;

        sayNative($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        Queue::assertPushed(RetryNativePush::class, fn (RetryNativePush $job) => $job->registrationId === tokenOf($friend)->id);
    });

    it('skips a platform whose credentials are not set up', function () {
        $this->native->configured['ios'] = false;
        $friend = withPhones('android', 'ios');

        sayNative($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        expect($this->native->fcm())->toHaveCount(1)
            ->and($this->native->apns())->toBe([]);
    });
});
