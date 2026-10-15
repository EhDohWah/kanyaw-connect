<?php

use App\Actions\Rooms\TransferRoomHost;
use App\Enums\RoomAdmission;
use App\Enums\RoomAuditAction;
use App\Enums\RoomRole;
use App\Models\Room;
use App\Models\RoomAuditLog;
use App\Models\User;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    fakeBroadcasts();
    $this->host = User::factory()->create(['name' => 'Saw Eh Doh']);
    $this->coHost = User::factory()->create();
    $this->guest = User::factory()->create(['name' => 'Naw Paw']);
    $this->waiting = User::factory()->create();
    $this->room = makeRoom($this->host, ['waiting_room_enabled' => true, 'status' => 'active']);
    addParticipant($this->room, $this->coHost, ['role' => RoomRole::CoHost, 'joined_at' => now()->subMinutes(3)]);
    addParticipant($this->room, $this->guest, ['joined_at' => now()->subMinutes(2)]);
    addParticipant($this->room, $this->waiting, ['admission' => RoomAdmission::Waiting]);
    $this->livekit->connected[$this->guest->id] = 1;
});

function act($test, string $method, Room $room, string $path, array $body = [])
{
    return $test->json($method, "/api/v1/rooms/{$room->id}/{$path}", $body);
}

/** The audit entries of a room, oldest first, as plain rows. */
function auditOf(Room $room)
{
    return RoomAuditLog::where('room_id', $room->id)->orderBy('created_at')->orderBy('id')->get();
}

describe('what gets recorded', function () {
    it('records who created the room and how it was set up', function () {
        $creator = signIn();

        $room = $this->postJson('/api/v1/rooms', ['name' => 'Weekly call', 'password' => 'open-sesame', 'waiting_room_enabled' => true, 'max_participants' => 12])
            ->assertCreated()->json('data.id');

        $entry = RoomAuditLog::where('room_id', $room)->sole();
        expect($entry->action)->toBe(RoomAuditAction::Created)
            ->and($entry->actor_id)->toBe($creator->id)
            ->and($entry->target_user_id)->toBeNull()
            ->and($entry->metadata)->toEqual(['type' => 'instant', 'chat_id' => null, 'waiting_room' => true, 'password_protected' => true, 'max_participants' => 12])
            ->and(json_encode($entry->metadata))->not->toContain('open-sesame');
    });

    it('records admitting and denying, with the person it was done to', function () {
        signIn($this->coHost);
        $other = User::factory()->create();
        addParticipant($this->room, $other, ['admission' => RoomAdmission::Waiting]);

        act($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();
        act($this, 'POST', $this->room, "deny/{$other->id}")->assertOk();

        $log = auditOf($this->room);
        expect($log->pluck('action')->all())->toBe([RoomAuditAction::ParticipantAdmitted, RoomAuditAction::ParticipantDenied])
            ->and($log->pluck('actor_id')->unique()->all())->toBe([$this->coHost->id])
            ->and($log->pluck('target_user_id')->all())->toBe([$this->waiting->id, $other->id]);
    });

    it('records removing a participant', function () {
        signIn($this->host);

        act($this, 'POST', $this->room, "participants/{$this->guest->id}/remove")->assertNoContent();

        $entry = auditOf($this->room)->sole();
        expect($entry->action)->toBe(RoomAuditAction::ParticipantRemoved)
            ->and($entry->actor_id)->toBe($this->host->id)
            ->and($entry->target_user_id)->toBe($this->guest->id);
    });

    it('still records a removal when LiveKit cannot be reached (the person is blocked either way)', function () {
        signIn($this->host);
        $this->livekit->down = true;

        act($this, 'POST', $this->room, "participants/{$this->guest->id}/remove")->assertStatus(503);

        expect(auditOf($this->room)->sole()->action)->toBe(RoomAuditAction::ParticipantRemoved)
            ->and($this->room->participantFor($this->guest)->fresh()->admission)->toBe(RoomAdmission::Denied);
    });

    it('records muting, with what was muted', function () {
        signIn($this->coHost);

        act($this, 'POST', $this->room, "participants/{$this->guest->id}/mute", ['kind' => 'video'])->assertOk();

        $entry = auditOf($this->room)->sole();
        expect($entry->action)->toBe(RoomAuditAction::ParticipantMuted)
            ->and($entry->actor_id)->toBe($this->coHost->id)
            ->and($entry->target_user_id)->toBe($this->guest->id)
            ->and($entry->metadata)->toBe(['kind' => 'video', 'muted_tracks' => 1]);
    });

    it('records appointing a co-host', function () {
        signIn($this->host);

        act($this, 'POST', $this->room, "co-hosts/{$this->guest->id}")->assertOk();

        $entry = auditOf($this->room)->sole();
        expect($entry->action)->toBe(RoomAuditAction::CoHostAppointed)
            ->and($entry->actor_id)->toBe($this->host->id)
            ->and($entry->target_user_id)->toBe($this->guest->id);
    });

    it('records locking and unlocking', function () {
        signIn($this->host);

        act($this, 'POST', $this->room, 'lock')->assertOk();
        act($this, 'POST', $this->room, 'unlock')->assertOk();

        expect(auditOf($this->room)->pluck('action')->all())->toBe([RoomAuditAction::Locked, RoomAuditAction::Unlocked])
            ->and(auditOf($this->room)->pluck('actor_id')->unique()->all())->toBe([$this->host->id]);
    });

    it('records ending the room', function () {
        signIn($this->host);

        act($this, 'POST', $this->room, 'end')->assertOk();

        $entry = auditOf($this->room)->sole();
        expect($entry->action)->toBe(RoomAuditAction::Ended)->and($entry->actor_id)->toBe($this->host->id);
    });

    it('records the system handing the host role on, with no actor', function () {
        $this->room->participants()->where('user_id', $this->host->id)->update(['joined_at' => now()->subMinutes(30), 'left_at' => now()]);

        app(TransferRoomHost::class)->handle($this->room, $this->host->id);

        $entry = auditOf($this->room)->sole();
        expect($entry->action)->toBe(RoomAuditAction::HostTransferred)
            ->and($entry->actor_id)->toBeNull()
            ->and($entry->target_user_id)->toBe($this->coHost->id)
            ->and($entry->metadata)->toBe(['previous_host_id' => $this->host->id]);
    });
});

describe('what does not get recorded', function () {
    it('ignores actions that change nothing', function () {
        signIn($this->host);

        act($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();
        act($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();  // already admitted
        act($this, 'POST', $this->room, 'unlock')->assertOk();                       // already unlocked
        act($this, 'POST', $this->room, 'lock')->assertOk();
        act($this, 'POST', $this->room, 'lock')->assertOk();                         // already locked
        act($this, 'POST', $this->room, "co-hosts/{$this->coHost->id}")->assertOk(); // already a co-host
        act($this, 'POST', $this->room, "deny/{$this->guest->id}")->assertStatus(409); // not waiting

        expect(auditOf($this->room)->pluck('action')->all())->toBe([RoomAuditAction::ParticipantAdmitted, RoomAuditAction::Locked]);
    });

    it('ignores refused requests', function (string $method, string $path, string $as) {
        signIn($this->{$as});

        act($this, $method, $this->room, str_replace(['{guest}', '{waiting}'], [$this->guest->id, $this->waiting->id], $path))->assertForbidden();

        expect(auditOf($this->room))->toHaveCount(0);
    })->with([
        'a guest admitting' => ['POST', 'admit/{waiting}', 'guest'],
        'a guest locking' => ['POST', 'lock', 'guest'],
        'a co-host ending the room' => ['POST', 'end', 'coHost'],
        'a co-host appointing a co-host' => ['POST', 'co-hosts/{guest}', 'coHost'],
        'a guest muting' => ['POST', 'participants/{waiting}/mute', 'guest'],
    ]);

    it('writes nothing if the action itself fails', function () {
        signIn($this->host);

        act($this, 'POST', $this->room, "participants/{$this->waiting->id}/mute")->assertStatus(409); // not connected

        expect(auditOf($this->room))->toHaveCount(0);
    });

    it('does not record the hosts joining or leaving; that is what the participants list is for', function () {
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $this->guest));

        expect(auditOf($this->room))->toHaveCount(0);
    });
});

describe('GET /rooms/{room}/audit-log', function () {
    it('shows the host what happened, newest first, with names', function () {
        signIn($this->host);
        act($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();
        $this->travel(1)->minute();
        act($this, 'POST', $this->room, 'lock')->assertOk();

        $response = act($this, 'GET', $this->room, 'audit-log')->assertOk();

        expect(array_column($response->json('data'), 'action'))->toBe(['room.locked', 'room.participant_admitted']);
        $response->assertJsonPath('data.0.actor.id', $this->host->id)
            ->assertJsonPath('data.0.actor.name', 'Saw Eh Doh')
            ->assertJsonPath('data.0.target', null)
            ->assertJsonPath('data.1.target.id', $this->waiting->id)
            ->assertJsonStructure(['data' => [['id', 'action', 'actor' => ['id', 'name', 'avatar_url'], 'target', 'metadata', 'created_at']], 'links', 'meta']);
        expect($response->json('data.0.metadata'))->toBe([]);
    });

    it('shows the system as a null actor', function () {
        RoomAuditLog::create(['room_id' => $this->room->id, 'action' => RoomAuditAction::AutoEnded, 'metadata' => ['reason' => 'empty'], 'created_at' => now()]);
        signIn($this->host);

        act($this, 'GET', $this->room, 'audit-log')->assertOk()
            ->assertJsonPath('data.0.actor', null)
            ->assertJsonPath('data.0.metadata.reason', 'empty');
    });

    it('never exposes email addresses, phone numbers or settings', function () {
        signIn($this->host);
        act($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();

        $body = act($this, 'GET', $this->room, 'audit-log')->assertOk()->getContent();

        expect($body)->not->toContain($this->waiting->email)->not->toContain($this->host->email)->not->toContain('"phone"')->not->toContain('"settings"');
    });

    it('is cursor paginated', function () {
        signIn($this->host);
        foreach (range(1, 5) as $i) {
            RoomAuditLog::create(['room_id' => $this->room->id, 'actor_id' => $this->host->id, 'action' => RoomAuditAction::Locked, 'created_at' => now()->addSeconds($i)]);
        }

        $first = act($this, 'GET', $this->room, 'audit-log?per_page=2')->assertOk();
        expect($first->json('data'))->toHaveCount(2)->and($first->json('meta.next_cursor'))->not->toBeNull();

        $second = $this->getJson($first->json('links.next'))->assertOk();
        $ids = array_merge(array_column($first->json('data'), 'id'), array_column($second->json('data'), 'id'));
        expect($second->json('data'))->toHaveCount(2)->and($ids)->toBe(array_unique($ids));
    });

    it('keeps entries of other rooms out', function () {
        $other = makeRoom($this->host);
        RoomAuditLog::create(['room_id' => $other->id, 'actor_id' => $this->host->id, 'action' => RoomAuditAction::Locked, 'created_at' => now()]);
        signIn($this->host);

        expect(act($this, 'GET', $this->room, 'audit-log')->assertOk()->json('data'))->toBe([]);
    });

    it('asks the database the same number of questions however long the log is', function () {
        signIn($this->host);
        $count = fn () => countQueries(fn () => act($this, 'GET', $this->room, 'audit-log')->assertOk());
        RoomAuditLog::create(['room_id' => $this->room->id, 'actor_id' => $this->host->id, 'target_user_id' => $this->guest->id, 'action' => RoomAuditAction::ParticipantRemoved, 'created_at' => now()]);
        $few = $count();

        foreach (range(1, 20) as $_) {
            RoomAuditLog::create(['room_id' => $this->room->id, 'actor_id' => $this->coHost->id, 'target_user_id' => $this->waiting->id, 'action' => RoomAuditAction::ParticipantAdmitted, 'created_at' => now()]);
        }

        expect($count())->toBe($few);
    });

    it('is for the host only, not even co-hosts', function (string $who) {
        signIn($this->{$who});

        act($this, 'GET', $this->room, 'audit-log')->assertForbidden();
    })->with(['coHost', 'guest', 'waiting']);

    it('answers a stranger with 403 and needs a login', function () {
        signIn();
        act($this, 'GET', makeRoom(null, ['chat_id' => makeGroup(User::factory()->create())->id]), 'audit-log')->assertForbidden();

        $this->app['auth']->forgetGuards();
        $this->getJson("/api/v1/rooms/{$this->room->id}/audit-log", ['Authorization' => ''])->assertUnauthorized();
    });

    it('answers 404 for a room that does not exist', function () {
        signIn($this->host);

        $this->getJson('/api/v1/rooms/'.Str::uuid().'/audit-log')->assertNotFound();
    });
});

it('is deleted together with its room, and keeps its entries when a user is deleted', function () {
    RoomAuditLog::create(['room_id' => $this->room->id, 'actor_id' => $this->guest->id, 'target_user_id' => $this->guest->id, 'action' => RoomAuditAction::ParticipantMuted, 'created_at' => now()]);

    $this->guest->forceDelete();
    $entry = auditOf($this->room)->sole();
    expect($entry->actor_id)->toBeNull()->and($entry->target_user_id)->toBeNull();

    $this->room->forceDelete();
    expect(RoomAuditLog::count())->toBe(0);
});
