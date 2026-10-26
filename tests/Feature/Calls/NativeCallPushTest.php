<?php

use App\Enums\PushOutcome;
use App\Jobs\ExpireRingingCall;
use App\Jobs\RetryNativePush;
use App\Models\Call;
use App\Models\NativePushToken;
use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\CallRingingOverNotification;
use App\Notifications\IncomingCallNotification;
use App\Services\NativePush\ApnsMessage;
use App\Services\NativePush\FcmMessage;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    fakeLiveKit();
    fakeBroadcasts();
    fakeWebPush();
    $this->native = fakeNativePush();
    $this->caller = User::factory()->create(['name' => 'Naw Paw']);
    $this->callee = User::factory()->create(['name' => 'Saw Htoo']);
    $this->android = NativePushToken::factory()->create(['user_id' => $this->callee->id]);
    $this->android2 = NativePushToken::factory()->create(['user_id' => $this->callee->id]);
    $this->iphone = NativePushToken::factory()->ios()->create(['user_id' => $this->callee->id]);
    $this->callerPhone = NativePushToken::factory()->create(['user_id' => $this->caller->id]);
    $this->chat = makeDirect($this->caller, $this->callee);
});

function ringFromApi($test, User $caller, $chat, string $kind = 'video'): Call
{
    signIn($caller);
    $test->postJson("/api/v1/chats/{$chat->id}/calls", ['kind' => $kind])->assertCreated();

    return Call::latest()->first();
}

/**
 * What one phone was sent, by type: the FCM data or the APNs payload "type".
 *
 * @return list<FcmMessage|ApnsMessage>
 */
function nativeOfType($native, string $token, string $type): array
{
    return array_values(array_filter($native->to($token), fn ($message) => ($message instanceof FcmMessage ? $message->data['type'] ?? null : $message->payload['type'] ?? null) === $type));
}

/** @return array{type: string, call_id: string, reason: string} the payload every phone got, checked to be the same */
function ringingOverPayloads($test, Call $call): array
{
    $android = nativeOfType($test->native, $test->android->token, 'call.ringing_over');
    $android2 = nativeOfType($test->native, $test->android2->token, 'call.ringing_over');
    $ios = nativeOfType($test->native, $test->iphone->voip_token, 'call.ringing_over');

    expect($android)->toHaveCount(1)->and($android2)->toHaveCount(1)->and($ios)->toHaveCount(1)
        ->and($android[0]->notification)->toBeNull()
        ->and($android[0]->highPriority)->toBeTrue()
        ->and($ios[0]->pushType)->toBe(ApnsMessage::VOIP)
        ->and($ios[0]->topic)->toBe('org.example.kanyawconnect.voip')
        ->and($ios[0]->priority)->toBe(10)
        ->and($ios[0]->payload)->toBe($android[0]->data)
        ->and($test->native->to($test->callerPhone->token))->toBe([]);

    return $ios[0]->payload;
}

describe('call.incoming', function () {
    it('rings every phone of the callee: FCM data on Android, VoIP on iOS', function () {
        $call = ringFromApi($this, $this->caller, $this->chat);

        expect(nativeOfType($this->native, $this->android->token, 'call.incoming'))->toHaveCount(1)
            ->and(nativeOfType($this->native, $this->android2->token, 'call.incoming'))->toHaveCount(1)
            ->and(nativeOfType($this->native, $this->iphone->voip_token, 'call.incoming'))->toHaveCount(1)
            ->and($this->native->to($this->iphone->token))->toBe([])
            ->and($this->native->to($this->callerPhone->token))->toBe([])
            ->and($call->callee_id)->toBe($this->callee->id);
    });

    it('is a high-priority data message on Android that expires with the ringing', function () {
        $this->freezeTime();
        $call = ringFromApi($this, $this->caller, $this->chat, 'voice');

        $message = nativeOfType($this->native, $this->android->token, 'call.incoming')[0]->toArray();
        expect($message)->not->toHaveKey('notification')
            ->and($message['android'])->toBe(['priority' => 'HIGH', 'ttl' => '45s'])
            ->and($message['data'])->toMatchArray([
                'type' => 'call.incoming',
                'call_id' => $call->id,
                'chat_id' => $this->chat->id,
                'room_id' => $call->room_id,
                'kind' => 'voice',
                'title' => 'Naw Paw',
                'body' => 'Incoming voice call',
                'ring_expires_at' => $call->ring_expires_at->toJSON(),
            ])
            ->and($message['data']['decline_url'])->toStartWith(url("/api/v1/calls/{$call->id}/decline?expires="));
    });

    it('is a VoIP push on iOS: the .voip topic, priority 10, expiring at ring_expires_at', function () {
        $call = ringFromApi($this, $this->caller, $this->chat);

        $message = nativeOfType($this->native, $this->iphone->voip_token, 'call.incoming')[0];
        expect($message->headers())->toMatchArray([
            'apns-push-type' => 'voip',
            'apns-topic' => 'org.example.kanyawconnect.voip',
            'apns-priority' => '10',
            'apns-expiration' => (string) $call->ring_expires_at->getTimestamp(),
        ])
            ->and($message->payload)->not->toHaveKey('aps')
            ->and($message->payload)->toMatchArray(['type' => 'call.incoming', 'call_id' => $call->id])
            ->and($message->payload['decline_url'])->toBeString();
    });

    it('gives Android only the seconds left when the queue is late', function () {
        $call = makeCall($this->caller, $this->callee);
        $notification = IncomingCallNotification::forCall($call->load('caller'));

        $this->travel(30)->seconds();
        $message = $notification->toNativePush($this->android, $this->native)[0];

        expect($message->ttlSeconds)->toBeGreaterThanOrEqual(14)->toBeLessThanOrEqual(15);
    });

    it('sends nothing to an iPhone that has no PushKit token: only PushKit can ring a closed app', function () {
        $this->iphone->forceFill(['voip_token' => null])->save();

        ringFromApi($this, $this->caller, $this->chat);

        expect($this->native->apns())->toBe([]);
    });

    it('is not retried, and a dead PushKit token is forgotten without losing the phone', function () {
        Queue::fake([RetryNativePush::class]);
        $this->native->outcomes[$this->android->token] = PushOutcome::Failed;
        $this->native->outcomes[$this->iphone->voip_token] = PushOutcome::Expired;

        ringFromApi($this, $this->caller, $this->chat);

        Queue::assertNotPushed(RetryNativePush::class);
        expect($this->iphone->fresh())->not->toBeNull()
            ->and($this->iphone->fresh()->voip_token)->toBeNull()
            ->and($this->iphone->fresh()->token)->toBe($this->iphone->token);
    });
});

describe('call.missed', function () {
    it('is an ordinary notification, never a VoIP push', function () {
        $call = ringFromApi($this, $this->caller, $this->chat, 'voice');
        $this->native->sent = [];

        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        $android = nativeOfType($this->native, $this->android->token, 'call.missed')[0]->toArray();
        expect($android['notification'])->toBe(['title' => 'Naw Paw', 'body' => 'Missed voice call'])
            ->and($android['android']['notification'])->toBe(['channel_id' => 'missed-calls']);

        $ios = nativeOfType($this->native, $this->iphone->token, 'call.missed');
        expect($ios)->toHaveCount(1)
            ->and($ios[0]->pushType)->toBe(ApnsMessage::ALERT)
            ->and($ios[0]->topic)->toBe('org.example.kanyawconnect')
            ->and($ios[0]->payload['aps']['alert'])->toBe(['title' => 'Naw Paw', 'body' => 'Missed voice call'])
            ->and(nativeOfType($this->native, $this->iphone->voip_token, 'call.missed'))->toBe([]);

        foreach ($this->native->apns(ApnsMessage::VOIP) as $voip) {
            expect($voip->payload['type'])->toBeIn(['call.incoming', 'call.ringing_over']);
        }
    });
});

describe('call.ringing_over', function () {
    it('says "answered" when the callee picks up (on any device)', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertOk();

        expect(ringingOverPayloads($this, $call))->toBe(['type' => 'call.ringing_over', 'call_id' => $call->id, 'reason' => 'answered']);
    });

    it('says "declined" when the callee declines', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        expect(ringingOverPayloads($this, $call)['reason'])->toBe('declined');
    });

    it('says "cancelled" when the caller hangs up first', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        expect(ringingOverPayloads($this, $call)['reason'])->toBe('cancelled');
    });

    it('says "no_answer" when the ringing runs out (the timeout job)', function () {
        $call = makeCall($this->caller, $this->callee);
        $this->travelTo($call->ring_expires_at->addSecond());

        app()->call([new ExpireRingingCall($call->id), 'handle']);

        expect($call->fresh()->status->value)->toBe('missed')
            ->and(ringingOverPayloads($this, $call)['reason'])->toBe('no_answer');
    });

    it('says "no_answer" when the stale-call cleanup ends the ringing', function () {
        $call = makeCall($this->caller, $this->callee);
        $this->travelTo($call->ring_expires_at->addSecond());

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(ringingOverPayloads($this, $call)['reason'])->toBe('no_answer');
    });

    it('lives at least 30 seconds, and is not retried', function () {
        Queue::fake([RetryNativePush::class]);
        $this->freezeTime();
        $call = makeCall($this->caller, $this->callee);
        $this->native->outcomes[$this->android->token] = PushOutcome::Failed;
        signIn($this->callee);

        $this->travelTo($call->ring_expires_at->subSeconds(5));
        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        $ios = nativeOfType($this->native, $this->iphone->voip_token, 'call.ringing_over')[0];
        $android = nativeOfType($this->native, $this->android->token, 'call.ringing_over')[0];
        expect($ios->expiration)->toBe(now()->addSeconds(CallRingingOverNotification::MIN_LIFETIME_SECONDS)->getTimestamp())
            ->and($android->ttlSeconds)->toBe(30);
        Queue::assertNotPushed(RetryNativePush::class);
    });

    it('is not sent when a call that was already answered ends', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk();

        expect($this->native->sent)->toBe([]);
    });

    it('is not sent to a callee with only browsers: their tabs hear it over the websocket', function () {
        NativePushToken::where('user_id', $this->callee->id)->delete();
        PushSubscription::factory()->create(['user_id' => $this->callee->id]);
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        expect($this->native->sent)->toBe([]);
    });
});
