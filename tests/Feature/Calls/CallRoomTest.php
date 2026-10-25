<?php

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Enums\RoomStatus;
use App\Events\CallEnded;
use App\Events\RoomEnded;
use App\Events\RoomRoleChanged;
use App\Jobs\EndCallAfterGrace;
use App\Models\Call;
use App\Models\RoomAuditLog;
use App\Models\User;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    fakeBroadcasts();
    fakeWebPush();
    $this->caller = User::factory()->create();
    $this->callee = User::factory()->create();
});

function joinCallRoom($test, Call $call, User $as)
{
    signIn($as);

    return $test->postJson("/api/v1/rooms/{$call->room_id}/join");
}

/** The `video` grant of a LiveKit token. */
function videoGrant(string $token): array
{
    return (array) JWT::decode($token, new Key(config('services.livekit.api_secret'), 'HS256'))->video;
}

describe('joining the room of a call', function () {
    it('lets the caller connect while it rings, so their media is ready when it is answered', function () {
        $call = makeCall($this->caller, $this->callee);

        joinCallRoom($this, $call, $this->caller)->assertOk()->assertJsonPath('status', 'admitted');
        expect($this->livekit->created)->toBe([$call->room->livekit_room_name]);
    });

    it('keeps the callee out until they answer', function () {
        $call = makeCall($this->caller, $this->callee);

        joinCallRoom($this, $call, $this->callee)->assertConflict()->assertJson(['code' => 'room_ended', 'message' => 'Answer the call before joining it.']);
    });

    it('lets both connect once it is answered', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()]);

        joinCallRoom($this, $call, $this->caller)->assertOk()->assertJsonPath('status', 'admitted');
        joinCallRoom($this, $call, $this->callee)->assertOk()->assertJsonPath('status', 'admitted');
    });

    it('is closed to both once the call is over', function (string $status) {
        $call = makeCall($this->caller, $this->callee, ['status' => $status, 'ended_at' => now()]);

        joinCallRoom($this, $call, $this->caller)->assertConflict()->assertJson(['code' => 'room_ended', 'message' => 'This room has ended.']);
        joinCallRoom($this, $call, $this->callee)->assertConflict()->assertJsonPath('code', 'room_ended');
    })->with(['declined', 'missed', 'ended']);

    it('is closed after hanging up, through the real flow', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()]);
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk();

        joinCallRoom($this, $call, $this->callee)->assertConflict()->assertJsonPath('code', 'room_ended');
    });

    it('keeps the caller out once the ringing has run out', function () {
        $call = makeCall($this->caller, $this->callee, ['ring_expires_at' => now()->subSecond()]);

        joinCallRoom($this, $call, $this->caller)->assertConflict()->assertJsonPath('code', 'room_ended');
    });

    it('cannot be seen or joined by anyone else', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()]);

        joinCallRoom($this, $call, User::factory()->create())->assertForbidden();
    });
});

describe('the LiveKit token', function () {
    it('lets a voice call publish the microphone only', function () {
        $call = makeCall($this->caller, $this->callee, ['kind' => 'voice', 'status' => 'ongoing', 'answered_at' => now()]);

        foreach ([$this->caller, $this->callee] as $person) {
            $grant = videoGrant(joinCallRoom($this, $call, $person)->assertOk()->json('token'));
            expect($grant['canPublishSources'])->toBe(['microphone'])
                ->and($grant['canPublish'])->toBeTrue()
                ->and($grant['canSubscribe'])->toBeTrue();
        }
    });

    it('does not limit what a video call publishes', function () {
        $call = makeCall($this->caller, $this->callee, ['kind' => 'video']);

        expect(videoGrant(joinCallRoom($this, $call, $this->caller)->json('token')))->not->toHaveKey('canPublishSources');
    });

    it('gives neither person host powers over the other', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()]);

        foreach ([$this->caller, $this->callee] as $person) {
            expect(videoGrant(joinCallRoom($this, $call, $person)->json('token')))->not->toHaveKey('roomAdmin');
        }
    });

    it('still makes the host of a meeting a room admin', function () {
        $room = makeRoom($this->caller);
        signIn($this->caller);

        expect(videoGrant($this->postJson("/api/v1/rooms/{$room->id}/join")->json('token')))->toHaveKey('roomAdmin', true)->not->toHaveKey('canPublishSources');
    });
});

describe('call rooms are not meetings', function () {
    it('leaves them out of GET /rooms, whatever the filter', function (?string $filter) {
        makeCall($this->caller, $this->callee);
        $meeting = makeRoom($this->caller);

        signIn($this->caller);
        $ids = collect($this->getJson('/api/v1/rooms'.($filter ? "?filter={$filter}" : ''))->assertOk()->json('data'))->pluck('id');

        expect($ids->all())->toBe($filter === 'invited' || $filter === 'upcoming' ? [] : [$meeting->id]);
    })->with([null, 'hosting', 'invited', 'upcoming']);

    it('leaves them out for the callee too', function () {
        makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->getJson('/api/v1/rooms')->assertOk()->assertJsonCount(0, 'data');
    });

    it('writes nothing to the audit log', function () {
        signIn($this->caller);
        $this->postJson('/api/v1/chats/'.makeDirect($this->caller, $this->callee)->id.'/calls', ['kind' => 'video'])->assertCreated();
        $call = Call::sole();
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        expect(RoomAuditLog::count())->toBe(0);
    });

    it('has no host controls: those go through the call endpoints', function (string $method, string $path) {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()]);
        signIn($this->caller);

        $this->json($method, "/api/v1/rooms/{$call->room_id}/".str_replace('{callee}', $this->callee->id, $path))
            ->assertForbidden()->assertJsonPath('message', 'This is a one-to-one call. Use the call endpoints instead.');

        expect($call->room->fresh()->status)->not->toBe(RoomStatus::Ended);
    })->with([
        ['POST', 'end'],
        ['POST', 'lock'],
        ['POST', 'participants/{callee}/remove'],
        ['POST', 'participants/{callee}/mute'],
        ['POST', 'co-hosts/{callee}'],
        ['GET', 'audit-log'],
    ]);
});

describe('the LiveKit webhook', function () {
    it('ends an answered call when LiveKit closes its room (connection_lost)', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        $call->room->update(['status' => RoomStatus::Active, 'started_at' => now()->subMinute()]);

        sendLiveKitWebhook($this, livekitEvent($call->room, 'room_finished'))->assertOk();

        expect($call->fresh()->status)->toBe(CallStatus::Ended)
            ->and($call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost)
            ->and($call->room->fresh()->status)->toBe(RoomStatus::Ended);
        Event::assertDispatched(CallEnded::class);
        Event::assertDispatched(RoomEnded::class);
    });

    it('ends it even if nobody had connected yet', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);

        sendLiveKitWebhook($this, livekitEvent($call->room, 'room_finished'))->assertOk();

        expect($call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost);
    });

    it('leaves a ringing call, and a call that is over, as they are', function () {
        $ringing = makeCall($this->caller, $this->callee);
        $over = makeCall(User::factory()->create(), User::factory()->create(), ['status' => 'declined', 'ended_at' => now()]);

        sendLiveKitWebhook($this, livekitEvent($ringing->room, 'room_finished'))->assertOk();
        sendLiveKitWebhook($this, livekitEvent($over->room, 'room_finished'))->assertOk();

        expect($ringing->fresh()->status)->toBe(CallStatus::Ringing)
            ->and($over->fresh()->status)->toBe(CallStatus::Declined);
        Event::assertNotDispatched(CallEnded::class);
    });

    it('hands nothing on when the caller (the room\'s host) drops out', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        sendLiveKitWebhook($this, livekitEvent($call->room, 'participant_joined', $this->caller))->assertOk();
        sendLiveKitWebhook($this, livekitEvent($call->room, 'participant_joined', $this->callee))->assertOk();

        sendLiveKitWebhook($this, livekitEvent($call->room, 'participant_left', $this->caller))->assertOk();

        expect($call->room->fresh()->host_id)->toBe($this->caller->id);
        Event::assertNotDispatched(RoomRoleChanged::class);
    });
});

describe('the reconnect grace', function () {
    beforeEach(function () {
        config(['calls.reconnect_grace_seconds' => 30]);
        $this->call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_joined', $this->caller))->assertOk();
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_joined', $this->callee))->assertOk();
    });

    it('keeps the call going for now when someone drops out', function () {
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();

        expect($this->call->fresh()->status)->toBe(CallStatus::Ongoing);
    });

    it('ends the call if they are still gone after the grace (connection_lost)', function () {
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();

        $this->travel(31)->seconds();
        EndCallAfterGrace::dispatchSync($this->call->id, $this->callee->id);

        expect($this->call->fresh()->status)->toBe(CallStatus::Ended)
            ->and($this->call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost)
            ->and($this->call->room->fresh()->status)->toBe(RoomStatus::Ended);
        Event::assertDispatched(CallEnded::class);
    });

    it('does not end it before the grace is over', function () {
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();

        $this->travel(20)->seconds();
        EndCallAfterGrace::dispatchSync($this->call->id, $this->callee->id);

        expect($this->call->fresh()->status)->toBe(CallStatus::Ongoing);
    });

    it('keeps the call if they came back in time', function () {
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();
        $this->travel(10)->seconds();
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_joined', $this->callee))->assertOk();

        $this->travel(25)->seconds();
        EndCallAfterGrace::dispatchSync($this->call->id, $this->callee->id);

        expect($this->call->fresh()->status)->toBe(CallStatus::Ongoing);
    });

    it('leaves a later drop to its own timer', function () {
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();
        $this->travel(10)->seconds();
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_joined', $this->callee))->assertOk();
        $this->travel(10)->seconds();
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();

        // The first drop's timer fires 30 s after the first drop: only 10 s after the second one.
        $this->travel(10)->seconds();
        EndCallAfterGrace::dispatchSync($this->call->id, $this->callee->id);
        expect($this->call->fresh()->status)->toBe(CallStatus::Ongoing);

        $this->travel(21)->seconds();
        EndCallAfterGrace::dispatchSync($this->call->id, $this->callee->id);
        expect($this->call->fresh()->status)->toBe(CallStatus::Ended);
    });

    it('schedules the check for when the grace runs out', function () {
        Queue::fake([EndCallAfterGrace::class]);

        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();

        Queue::assertPushed(EndCallAfterGrace::class, fn (EndCallAfterGrace $job) => $job->callId === $this->call->id
            && $job->userId === $this->callee->id
            && abs(now()->addSeconds(30)->diffInSeconds($job->delay)) <= 1);
    });

    it('waits as long as calls.reconnect_grace_seconds says', function () {
        config(['calls.reconnect_grace_seconds' => 45]);
        Queue::fake([EndCallAfterGrace::class]);

        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();

        Queue::assertPushed(EndCallAfterGrace::class, fn (EndCallAfterGrace $job) => abs(now()->addSeconds(45)->diffInSeconds($job->delay)) <= 1);
    });

    it('ends the call at once with a grace of 0', function () {
        config(['calls.reconnect_grace_seconds' => 0]);

        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->caller))->assertOk();

        expect($this->call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost);
    });

    it('does nothing for a call that ended meanwhile', function () {
        sendLiveKitWebhook($this, livekitEvent($this->call->room, 'participant_left', $this->callee))->assertOk();
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$this->call->id}/end")->assertOk();

        $this->travel(31)->seconds();
        EndCallAfterGrace::dispatchSync($this->call->id, $this->callee->id);

        expect($this->call->fresh()->end_reason)->toBe(CallEndReason::HungUp);
        Event::assertDispatchedTimes(CallEnded::class, 1);
    });

    it('is not started by someone leaving while it still rings', function () {
        Queue::fake([EndCallAfterGrace::class]);
        $ringing = makeCall(User::factory()->create(), User::factory()->create());
        sendLiveKitWebhook($this, livekitEvent($ringing->room, 'participant_joined', $ringing->caller))->assertOk();

        sendLiveKitWebhook($this, livekitEvent($ringing->room, 'participant_left', $ringing->caller))->assertOk();

        Queue::assertNotPushed(EndCallAfterGrace::class);
        expect($ringing->fresh()->status)->toBe(CallStatus::Ringing);
    });
});
