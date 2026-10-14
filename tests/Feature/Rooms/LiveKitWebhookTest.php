<?php

use App\Enums\RoomAdmission;
use App\Events\RoomEnded;
use App\Events\RoomParticipantJoined;
use App\Events\RoomParticipantLeft;
use App\Models\User;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    fakeBroadcasts();
    $this->host = User::factory()->create();
    $this->guest = User::factory()->create(['phone' => '+66877777777']);
    $this->room = makeRoom($this->host, ['max_participants' => 10]);
    $this->guestRow = addParticipant($this->room, $this->guest, ['token_issued_at' => now()]);
});

describe('signature', function () {
    it('accepts a correctly signed webhook', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest))->assertOk();
    });

    it('accepts the token with a Bearer prefix', function () {
        $event = array_merge(['id' => 'EV_fixed', 'createdAt' => (string) now()->timestamp], livekitEvent($this->room, 'participant_joined', $this->guest));
        $token = livekitWebhookToken(json_encode($event));

        sendLiveKitWebhook($this, $event, ['authorization' => 'Bearer '.$token])->assertOk();
    });

    it('rejects a token signed with the wrong secret', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest), ['secret' => 'another-secret-another-secret-0123456789'])
            ->assertUnauthorized()
            ->assertJsonStructure(['message']);

        expect($this->guestRow->fresh()->joined_at)->toBeNull();
    });

    it('rejects a body that was changed after signing', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest), ['signedBody' => '{"event":"something else"}'])
            ->assertUnauthorized();

        expect($this->guestRow->fresh()->joined_at)->toBeNull();
    });

    it('rejects a missing or malformed Authorization header', function (?string $header) {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest), ['authorization' => $header])->assertUnauthorized();
    })->with([null, '', 'not-a-jwt', 'Bearer ']);

    it('rejects an expired token', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest), ['claims' => ['nbf' => time() - 900, 'exp' => time() - 120]])
            ->assertUnauthorized();

        expect($this->guestRow->fresh()->joined_at)->toBeNull();
    });

    it('rejects a token issued to a different API key', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest), ['claims' => ['iss' => 'someone-elses-key']])
            ->assertUnauthorized();
    });

    it('does not need a bearer token or login', function () {
        $this->app['auth']->forgetGuards();

        sendLiveKitWebhook($this, livekitEvent($this->room, 'room_started'))->assertOk();
    });
});

describe('participant_joined', function () {
    it('records the join, clears the held seat and starts the room', function () {
        $at = now()->subSeconds(3)->startOfSecond();

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest, ['createdAt' => (string) $at->timestamp]))->assertOk();

        $row = $this->guestRow->fresh();
        $room = $this->room->fresh();
        expect($row->joined_at->eq($at))->toBeTrue()
            ->and($row->left_at)->toBeNull()
            ->and($row->token_issued_at)->toBeNull()
            ->and($room->status->value)->toBe('active')
            ->and($room->started_at->eq($at))->toBeTrue();
    });

    it('broadcasts it to the room without anyone\'s contact details', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest))->assertOk();

        Event::assertDispatched(RoomParticipantJoined::class, function (RoomParticipantJoined $event) {
            expect($event->broadcastAs())->toBe('room.participant_joined')
                ->and(channelNames($event))->toBe(["presence-room.{$this->room->id}"])
                ->and(payloadOf($event))->toBe([
                    'room_id' => $this->room->id,
                    'user' => ['id' => $this->guest->id, 'name' => $this->guest->name, 'avatar_url' => null, 'avatar_thumb_url' => null],
                    'role' => 'participant',
                ]);
            expect(json_encode($event->broadcastWith()))->not->toContain($this->guest->email)->not->toContain('+66877777777');

            return true;
        });
    });

    it('does not restart a room that is already running', function () {
        $this->room->update(['status' => 'active', 'started_at' => now()->subHour()]);
        $startedAt = $this->room->fresh()->started_at;

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest))->assertOk();

        expect($this->room->fresh()->started_at->eq($startedAt))->toBeTrue();
    });

    it('is safe to receive twice', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest))->assertOk();
        $joinedAt = $this->guestRow->fresh()->joined_at;
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest, ['createdAt' => (string) (now()->timestamp + 30)]))->assertOk();

        expect($this->guestRow->fresh()->joined_at->eq($joinedAt))->toBeTrue();
        Event::assertDispatchedTimes(RoomParticipantJoined::class, 1);
    });

    it('records a rejoin after a leave', function () {
        $t = now()->startOfSecond();
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest, ['createdAt' => (string) $t->copy()->subSeconds(30)->timestamp]));
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest, ['createdAt' => (string) $t->copy()->subSeconds(20)->timestamp]));
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest, ['createdAt' => (string) $t->copy()->subSeconds(10)->timestamp]));

        $row = $this->guestRow->fresh();
        expect($row->isPresent())->toBeTrue()->and($row->joined_at->eq($t->copy()->subSeconds(10)))->toBeTrue();
        Event::assertDispatchedTimes(RoomParticipantJoined::class, 2);
    });

    it('ignores a "joined" that arrives late, after a newer "left"', function () {
        $t = now()->startOfSecond();
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest, ['createdAt' => (string) $t->copy()->subSeconds(30)->timestamp]));
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest, ['createdAt' => (string) $t->copy()->subSeconds(10)->timestamp]));
        // A retry of the first "joined" shows up now.
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest, ['createdAt' => (string) $t->copy()->subSeconds(30)->timestamp]));

        expect($this->guestRow->fresh()->isPresent())->toBeFalse();
    });

    it('puts out anyone who connects without being admitted', function (string $case) {
        $intruder = User::factory()->create();
        match ($case) {
            'never asked' => null,
            'denied' => addParticipant($this->room, $intruder, ['admission' => RoomAdmission::Denied]),
            'waiting' => addParticipant($this->room, $intruder, ['admission' => RoomAdmission::Waiting]),
        };

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $intruder))->assertOk();

        expect($this->livekit->removed)->toBe([['room' => $this->room->livekit_room_name, 'user' => $intruder->id]])
            ->and($this->room->participants()->where('user_id', $intruder->id)->whereNotNull('joined_at')->exists())->toBeFalse()
            ->and($this->room->fresh()->status->value)->toBe('waiting');
        Event::assertNotDispatched(RoomParticipantJoined::class);
    })->with(['never asked', 'denied', 'waiting']);

    it('puts out anyone who connects to a room that has ended', function () {
        $this->room->update(['status' => 'ended', 'ended_at' => now()]);

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->guest))->assertOk();

        expect($this->livekit->removed)->toHaveCount(1)->and($this->guestRow->fresh()->joined_at)->toBeNull();
    });

    it('ignores connections that are not users (recorders, agents)', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', null, ['participant' => ['identity' => 'EG_recorder']]))->assertOk();

        expect($this->livekit->removed)->toBe([]);
        Event::assertNotDispatched(RoomParticipantJoined::class);
    });
});

describe('participant_left', function () {
    beforeEach(function () {
        $this->guestRow->update(['joined_at' => now()->subMinutes(5), 'token_issued_at' => null]);
    });

    it('records the leave and broadcasts it', function () {
        $at = now()->startOfSecond();

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest, ['createdAt' => (string) $at->timestamp]))->assertOk();

        $row = $this->guestRow->fresh();
        expect($row->left_at->eq($at))->toBeTrue()->and($row->isPresent())->toBeFalse();

        Event::assertDispatched(RoomParticipantLeft::class, function (RoomParticipantLeft $event) {
            expect($event->broadcastAs())->toBe('room.participant_left')
                ->and(channelNames($event))->toBe(["presence-room.{$this->room->id}"])
                ->and(payloadOf($event)['user']['id'])->toBe($this->guest->id)
                ->and(payloadOf($event)['role'])->toBe('participant');

            return true;
        });
    });

    it('frees their seat', function () {
        $this->room->update(['max_participants' => 2]);
        $this->room->participants()->where('user_id', $this->host->id)->update(['joined_at' => now()]);

        $newcomer = signIn();
        $this->postJson("/api/v1/rooms/{$this->room->id}/join")->assertStatus(409)->assertJsonPath('code', 'room_full');

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest));

        signIn($newcomer);
        $this->postJson("/api/v1/rooms/{$this->room->id}/join")->assertOk();
    });

    it('is safe to receive twice', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest))->assertOk();
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest))->assertOk();

        Event::assertDispatchedTimes(RoomParticipantLeft::class, 1);
    });

    it('ignores a "left" that is older than the latest join', function () {
        $t = now()->startOfSecond();
        $this->guestRow->update(['joined_at' => $t]);

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest, ['createdAt' => (string) $t->copy()->subSeconds(20)->timestamp]))->assertOk();

        expect($this->guestRow->fresh()->isPresent())->toBeTrue();
        Event::assertNotDispatched(RoomParticipantLeft::class);
    });

    it('ignores someone who was never recorded as joined', function () {
        $other = User::factory()->create();
        addParticipant($this->room, $other);

        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $other))->assertOk();

        Event::assertNotDispatched(RoomParticipantLeft::class);
    });
});

describe('room_finished', function () {
    it('ends a room that was running, and everyone in it', function () {
        $this->room->update(['status' => 'active', 'started_at' => now()->subHour()]);
        $this->guestRow->update(['joined_at' => now()->subMinutes(5), 'token_issued_at' => null]);

        sendLiveKitWebhook($this, livekitEvent($this->room, 'room_finished'))->assertOk();

        $room = $this->room->fresh();
        expect($room->status->value)->toBe('ended')
            ->and($room->ended_at)->not->toBeNull()
            ->and($this->guestRow->fresh()->left_at)->not->toBeNull();

        Event::assertDispatched(RoomEnded::class, fn (RoomEnded $e) => channelNames($e) === ["presence-room.{$this->room->id}"]);
    });

    it('is safe to receive twice', function () {
        $this->room->update(['status' => 'active']);

        sendLiveKitWebhook($this, livekitEvent($this->room, 'room_finished'))->assertOk();
        sendLiveKitWebhook($this, livekitEvent($this->room, 'room_finished'))->assertOk();

        Event::assertDispatchedTimes(RoomEnded::class, 1);
    });

    it('leaves a room nobody ever joined, so a scheduled meeting is not ended before it starts', function () {
        $this->room->update(['type' => 'scheduled', 'scheduled_at' => now()->addHours(2)]);

        sendLiveKitWebhook($this, livekitEvent($this->room, 'room_finished'))->assertOk();

        expect($this->room->fresh()->status->value)->toBe('waiting');
        Event::assertNotDispatched(RoomEnded::class);
    });

    it('does not tell LiveKit to delete a room it already closed', function () {
        $this->room->update(['status' => 'active']);

        sendLiveKitWebhook($this, livekitEvent($this->room, 'room_finished'))->assertOk();

        expect($this->livekit->deleted)->toBe([]);
    });
});

describe('everything else', function () {
    it('acknowledges events it does not use', function (string $name) {
        sendLiveKitWebhook($this, livekitEvent($this->room, $name, $this->guest))->assertOk();

        expect($this->guestRow->fresh()->joined_at)->toBeNull();
    })->with(['room_started', 'track_published', 'track_unpublished', 'egress_started']);

    it('acknowledges events for rooms it does not know', function () {
        sendLiveKitWebhook($this, ['event' => 'participant_joined', 'room' => ['name' => 'someone-elses-room'], 'participant' => ['identity' => $this->guest->id]])->assertOk();

        Event::assertNotDispatched(RoomParticipantJoined::class);
    });

    it('acknowledges an event without a room', function () {
        sendLiveKitWebhook($this, ['event' => 'egress_ended'])->assertOk();
    });

    it('tolerates fields it does not know about', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'room_started', null, ['someFutureField' => ['a' => 1]]))->assertOk();
    });
});
