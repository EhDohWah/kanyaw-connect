<?php

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Events\CallIncoming;
use App\Models\Call;
use App\Models\Message;
use App\Models\RoomAuditLog;
use App\Models\User;
use Illuminate\Support\Facades\Event;

beforeEach(function () {
    fakeLiveKit();
    fakeBroadcasts();
    fakeWebPush();
    $this->caller = signIn(User::factory()->create(['name' => 'Naw Paw']));
    $this->callee = User::factory()->create(['name' => 'Saw Htoo']);
    $this->chat = makeDirect($this->caller, $this->callee);
});

function ring($test, $chat, string $kind = 'video')
{
    return $test->postJson("/api/v1/chats/{$chat->id}/calls", ['kind' => $kind]);
}

describe('starting a call', function () {
    it('rings the other person and returns the call', function () {
        $this->freezeTime();

        $response = ring($this, $this->chat)->assertCreated();

        $call = Call::sole();
        expect($response->json('data'))->toBe([
            'id' => $call->id,
            'chat_id' => $this->chat->id,
            'room_id' => $call->room_id,
            'kind' => 'video',
            'status' => 'ringing',
            'end_reason' => null,
            'caller' => ['id' => $this->caller->id, 'name' => 'Naw Paw', 'avatar_url' => null, 'avatar_thumb_url' => null],
            'callee' => ['id' => $this->callee->id, 'name' => 'Saw Htoo', 'avatar_url' => null, 'avatar_thumb_url' => null],
            'created_at' => now()->toJSON(),
            'ring_expires_at' => now()->addSeconds(45)->toJSON(),
            'answered_at' => null,
            'ended_at' => null,
            'duration_seconds' => null,
        ]);
    });

    it('starts a voice call', function () {
        ring($this, $this->chat, 'voice')->assertCreated()->assertJsonPath('data.kind', 'voice');
    });

    it('rings for as long as calls.ring_seconds says', function () {
        config(['calls.ring_seconds' => 20]);
        $this->freezeTime();

        ring($this, $this->chat)->assertCreated()->assertJsonPath('data.ring_expires_at', now()->addSeconds(20)->toJSON());
    });

    it('creates a two-seat room on the chat with the caller as host and the callee already let in', function () {
        ring($this, $this->chat)->assertCreated();

        $room = Call::sole()->room;
        expect($room->type->value)->toBe('instant')
            ->and($room->chat_id)->toBe($this->chat->id)
            ->and($room->host_id)->toBe($this->caller->id)
            ->and($room->max_participants)->toBe(2)
            ->and($room->hasPassword())->toBeFalse()
            ->and($room->waiting_room_enabled)->toBeFalse()
            ->and($room->status->value)->toBe('waiting')
            ->and($room->livekit_room_name)->toStartWith('kc-call-');

        $people = $room->participants()->get()->keyBy('user_id');
        expect($people)->toHaveCount(2)
            ->and($people[$this->caller->id]->role)->toBe(RoomRole::Host)
            ->and($people[$this->caller->id]->admission)->toBe(RoomAdmission::Admitted)
            ->and($people[$this->callee->id]->role)->toBe(RoomRole::Participant)
            ->and($people[$this->callee->id]->admission)->toBe(RoomAdmission::Admitted);
    });

    it('posts no "room started" message and writes no audit entry', function () {
        ring($this, $this->chat)->assertCreated();

        expect(Message::where('chat_id', $this->chat->id)->count())->toBe(0)
            ->and(RoomAuditLog::count())->toBe(0);
    });

    it('tells only the callee, on their user channel', function () {
        ring($this, $this->chat)->assertCreated();

        Event::assertDispatched(CallIncoming::class, function (CallIncoming $event) {
            return channelNames($event) === ["private-user.{$this->callee->id}"]
                && $event->broadcastAs() === 'call.incoming'
                && payloadOf($event)['call']['id'] === Call::sole()->id
                && payloadOf($event)['call']['status'] === 'ringing';
        });
    });

    it('works in an end-to-end encrypted direct chat too', function () {
        $other = User::factory()->create();

        ring($this, makeEncryptedDirect($this->caller, $other))->assertCreated();
    });

    it('can call again once the last call is over', function () {
        makeCall($this->caller, $this->callee, ['status' => 'ended', 'end_reason' => 'hung_up', 'answered_at' => now()->subMinutes(2), 'ended_at' => now()->subMinute()]);

        ring($this, $this->chat)->assertCreated();
    });
});

describe('who may start one', function () {
    it('needs a signed-in user', function () {
        app('auth')->forgetGuards();

        $this->postJson("/api/v1/chats/{$this->chat->id}/calls", ['kind' => 'video'])->assertUnauthorized();
    });

    it('refuses a group chat', function () {
        $group = makeGroup($this->caller, [$this->callee]);

        ring($this, $group)->assertForbidden()->assertJsonPath('message', 'Calls are only possible in direct chats. Start a video room for a group.');
        expect(Call::count())->toBe(0);
    });

    it('refuses someone who is not in the chat', function () {
        signIn();

        ring($this, $this->chat)->assertForbidden();
        expect(Call::count())->toBe(0);
    });

    it('refuses when the other person has deleted their account', function () {
        $this->callee->delete();

        ring($this, $this->chat)->assertForbidden();
    });

    it('validates the kind', function (?string $kind) {
        $this->postJson("/api/v1/chats/{$this->chat->id}/calls", array_filter(['kind' => $kind]))
            ->assertUnprocessable()->assertJsonValidationErrors('kind');
    })->with([null, 'screen', 'VIDEO']);

    it('allows 10 starts a minute', function () {
        foreach (range(1, 10) as $_) {
            ring($this, $this->chat); // the first rings, the rest are already_in_call
        }

        ring($this, $this->chat)->assertTooManyRequests();
    });
});

describe('busy', function () {
    it('refuses with already_in_call while the caller has a call ringing', function () {
        makeCall($this->caller, User::factory()->create());

        ring($this, $this->chat)->assertConflict()->assertJson(['code' => 'already_in_call', 'message' => 'You are already in a call.']);
        expect(Call::count())->toBe(1);
    });

    it('refuses with already_in_call while the caller is in a call someone else made', function () {
        makeCall(User::factory()->create(), $this->caller, ['status' => 'ongoing', 'answered_at' => now()]);

        ring($this, $this->chat)->assertConflict()->assertJsonPath('code', 'already_in_call');
    });

    it('refuses with callee_busy while the callee has a call ringing or going on', function (string $status) {
        makeCall(User::factory()->create(), $this->callee, ['status' => $status, 'answered_at' => $status === 'ongoing' ? now() : null]);

        ring($this, $this->chat)->assertConflict()->assertJson(['code' => 'callee_busy', 'message' => 'They are in another call.']);
    })->with(['ringing', 'ongoing']);

    it('says already_in_call when calling the person who is ringing you', function () {
        makeCall($this->callee, $this->caller); // they are calling me

        ring($this, $this->chat)->assertConflict()->assertJsonPath('code', 'already_in_call');
    });

    it('is not fooled by a call that rang out but was not marked missed yet', function () {
        $stale = makeCall($this->callee, User::factory()->create(), ['ring_expires_at' => now()->subSecond()]);

        ring($this, $this->chat)->assertCreated();

        expect($stale->fresh()->status)->toBe(CallStatus::Missed)
            ->and($stale->fresh()->end_reason)->toBe(CallEndReason::NoAnswer);
    });
});
