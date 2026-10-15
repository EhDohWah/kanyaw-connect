<?php

use App\Enums\RoomAuditAction;
use App\Enums\RoomRole;
use App\Enums\RoomStatus;
use App\Events\RoomEnded;
use App\Models\Room;
use App\Models\RoomAuditLog;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Log;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    fakeBroadcasts();
    $this->host = User::factory()->create();
});

/** A room as it would be left behind. Pass created_at / scheduled_at / started_at to place it in time. */
function leftBehind(array $attributes = []): Room
{
    $room = makeRoom(test()->host, $attributes);
    if (isset($attributes['created_at'])) {
        DB::table('rooms')->where('id', $room->id)->update(['created_at' => $attributes['created_at']]);
    }

    return $room;
}

/** Say when a person was in the call: joined, and left (or still there when $leftAgo is null). */
function inCall(Room $room, User $user, int $joinedMinutesAgo, ?int $leftMinutesAgo = null): void
{
    $row = $room->participants()->where('user_id', $user->id)->first() ?? addParticipant($room, $user);
    $row->forceFill([
        'joined_at' => now()->subMinutes($joinedMinutesAgo),
        'left_at' => $leftMinutesAgo === null ? null : now()->subMinutes($leftMinutesAgo),
    ])->save();
}

function status(Room $room): RoomStatus
{
    return $room->fresh()->status;
}

describe('rooms nobody ever joined', function () {
    it('ends an instant room more than a day after it was created', function () {
        $stale = leftBehind(['created_at' => now()->subHours(25)]);
        $fresh = leftBehind(['created_at' => now()->subHours(23)]);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($stale))->toBe(RoomStatus::Ended)->and(status($fresh))->toBe(RoomStatus::Waiting);
        expect($stale->fresh()->ended_at)->not->toBeNull();
    });

    it('waits for a scheduled room\'s time, its length and a day of grace', function () {
        $future = leftBehind(['type' => 'scheduled', 'scheduled_at' => now()->addDays(3)]);
        $justHappened = leftBehind(['type' => 'scheduled', 'scheduled_at' => now()->subHours(2), 'duration_minutes' => 60, 'created_at' => now()->subDays(10)]);
        $withinGrace = leftBehind(['type' => 'scheduled', 'scheduled_at' => now()->subHours(20), 'duration_minutes' => 60, 'created_at' => now()->subDays(10)]);
        $longAgo = leftBehind(['type' => 'scheduled', 'scheduled_at' => now()->subHours(30), 'duration_minutes' => 60, 'created_at' => now()->subDays(10)]);
        $longMeeting = leftBehind(['type' => 'scheduled', 'scheduled_at' => now()->subHours(30), 'duration_minutes' => 8 * 60, 'created_at' => now()->subDays(10)]);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($future))->toBe(RoomStatus::Waiting)
            ->and(status($justHappened))->toBe(RoomStatus::Waiting)
            ->and(status($withinGrace))->toBe(RoomStatus::Waiting)
            ->and(status($longAgo))->toBe(RoomStatus::Ended)
            ->and(status($longMeeting))->toBe(RoomStatus::Waiting);   // 30 h ago + 8 h meeting = 22 h ago: still within a day
    });

    it('uses the creation time when a scheduled room has no scheduled time', function () {
        $room = leftBehind(['type' => 'scheduled', 'created_at' => now()->subHours(30)]);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($room))->toBe(RoomStatus::Ended);
    });

    it('follows the configured grace period', function () {
        config(['cleanup.stale_rooms.never_started_hours' => 2]);
        $room = leftBehind(['created_at' => now()->subHours(3)]);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($room))->toBe(RoomStatus::Ended);
    });
});

describe('rooms that started and were abandoned', function () {
    it('ends an active room when nobody has been connected for an hour', function () {
        $abandoned = leftBehind(['status' => 'active', 'started_at' => now()->subHours(3)]);
        inCall($abandoned, $this->host, joinedMinutesAgo: 170, leftMinutesAgo: 61);
        $recent = leftBehind(['status' => 'active', 'started_at' => now()->subHours(3)]);
        inCall($recent, $this->host, joinedMinutesAgo: 170, leftMinutesAgo: 59);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($abandoned))->toBe(RoomStatus::Ended)->and(status($recent))->toBe(RoomStatus::Active);
    });

    it('measures from the last person to leave, not the first', function () {
        $room = leftBehind(['status' => 'active', 'started_at' => now()->subHours(5)]);
        inCall($room, $this->host, joinedMinutesAgo: 290, leftMinutesAgo: 200);
        inCall($room, User::factory()->create(), joinedMinutesAgo: 250, leftMinutesAgo: 20);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($room))->toBe(RoomStatus::Active);
    });

    it('leaves a room alone while anyone is still connected', function () {
        $room = leftBehind(['status' => 'active', 'started_at' => now()->subHours(5)]);
        inCall($room, $this->host, joinedMinutesAgo: 290, leftMinutesAgo: 200);
        inCall($room, User::factory()->create(), joinedMinutesAgo: 120);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($room))->toBe(RoomStatus::Active);
    });

    it('ends a room that has run for more than a day even if people appear to be connected (missed webhooks)', function () {
        $ghost = leftBehind(['status' => 'active', 'started_at' => now()->subHours(25)]);
        $stillThere = User::factory()->create();
        inCall($ghost, $this->host, joinedMinutesAgo: 25 * 60, leftMinutesAgo: null);
        inCall($ghost, $stillThere, joinedMinutesAgo: 24 * 60, leftMinutesAgo: null);
        $long = leftBehind(['status' => 'active', 'started_at' => now()->subHours(23)]);
        inCall($long, $this->host, joinedMinutesAgo: 23 * 60, leftMinutesAgo: null);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($ghost))->toBe(RoomStatus::Ended)->and(status($long))->toBe(RoomStatus::Active);
        // Nobody is left listed as connected in the ended room.
        expect($ghost->participants()->whereNull('left_at')->whereNotNull('joined_at')->count())->toBe(0);
    });

    it('never ends a room that is already over', function () {
        $ended = leftBehind(['status' => 'ended', 'started_at' => now()->subDays(5), 'ended_at' => now()->subDays(4), 'created_at' => now()->subDays(6)]);
        $endedAt = $ended->fresh()->ended_at;

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect($ended->fresh()->ended_at->equalTo($endedAt))->toBeTrue()
            ->and(RoomAuditLog::count())->toBe(0);
    });

    it('ignores deleted rooms', function () {
        $room = leftBehind(['created_at' => now()->subDays(3)]);
        $room->delete();

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 0 room(s) nobody joined, 0 empty and 0 running too long.')->assertSuccessful();

        expect($this->livekit->deleted)->toBe([]);
    });
});

describe('how a room is ended', function () {
    it('closes it in LiveKit, tells the room, and writes an audit entry with no actor', function () {
        Event::fake([RoomEnded::class]);
        $room = leftBehind(['status' => 'active', 'started_at' => now()->subHours(3)]);
        inCall($room, $this->host, joinedMinutesAgo: 170, leftMinutesAgo: 90);

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 0 room(s) nobody joined, 1 empty and 0 running too long.')->assertSuccessful();

        expect($this->livekit->deleted)->toBe([$room->livekit_room_name]);
        Event::assertDispatched(RoomEnded::class, fn (RoomEnded $e) => $e->roomId === $room->id && $e->broadcastAs() === 'room.ended');

        $entry = RoomAuditLog::where('room_id', $room->id)->sole();
        expect($entry->action)->toBe(RoomAuditAction::AutoEnded)
            ->and($entry->actor_id)->toBeNull()
            ->and($entry->metadata)->toBe(['reason' => 'empty']);
    });

    it('records why each room was ended', function () {
        leftBehind(['created_at' => now()->subHours(30)]);
        $ghost = leftBehind(['status' => 'active', 'started_at' => now()->subHours(30)]);
        inCall($ghost, $this->host, joinedMinutesAgo: 1800, leftMinutesAgo: null);

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 1 room(s) nobody joined, 0 empty and 1 running too long.')->assertSuccessful();

        expect(RoomAuditLog::all()->map(fn ($e) => $e->metadata['reason'])->sort()->values()->all())->toBe(['never_started', 'too_long']);
    });

    it('leaves a room for the next run when LiveKit is unavailable, without stopping the others', function () {
        $first = leftBehind(['created_at' => now()->subHours(30)]);
        $second = leftBehind(['created_at' => now()->subHours(30)]);
        $this->livekit->down = true;
        Log::spy();

        $this->artisan('rooms:end-stale')
            ->expectsOutput('Ended 0 room(s) nobody joined, 0 empty and 0 running too long.')
            ->expectsOutputToContain('2 room(s) could not be closed because LiveKit is unavailable')
            ->assertSuccessful();

        expect(status($first))->toBe(RoomStatus::Waiting)->and(status($second))->toBe(RoomStatus::Waiting)
            ->and(RoomAuditLog::count())->toBe(0);

        $this->livekit->down = false;
        $this->artisan('rooms:end-stale')->expectsOutput('Ended 2 room(s) nobody joined, 0 empty and 0 running too long.')->assertSuccessful();
        expect(status($first))->toBe(RoomStatus::Ended)->and(status($second))->toBe(RoomStatus::Ended);
    });

    it('does not end a room that someone joined after it was listed', function () {
        $room = leftBehind(['status' => 'active', 'started_at' => now()->subHours(3)]);
        inCall($room, $this->host, joinedMinutesAgo: 170, leftMinutesAgo: 90);
        $guest = User::factory()->create();

        // Between listing the stale rooms and ending this one, a person connects.
        $joined = false;
        Room::retrieved(function (Room $r) use (&$joined, $room, $guest) {
            if (! $joined && $r->is($room)) {
                $joined = true;
                addParticipant($room, $guest, ['joined_at' => now(), 'left_at' => null]);
            }
        });

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(status($room))->toBe(RoomStatus::Active)->and($this->livekit->deleted)->toBe([]);
    });

    it('is safe to run again and again', function () {
        leftBehind(['created_at' => now()->subHours(30)]);

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 1 room(s) nobody joined, 0 empty and 0 running too long.')->assertSuccessful();
        $this->artisan('rooms:end-stale')->expectsOutput('Ended 0 room(s) nobody joined, 0 empty and 0 running too long.')->assertSuccessful();

        expect(RoomAuditLog::count())->toBe(1);
    });

    it('handles many rooms in batches', function () {
        config(['cleanup.chunk_size' => 3]);
        foreach (range(1, 8) as $_) {
            leftBehind(['created_at' => now()->subHours(30)]);
        }

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 8 room(s) nobody joined, 0 empty and 0 running too long.')->assertSuccessful();

        expect(Room::where('status', 'ended')->count())->toBe(8);
    });

    it('does not mark a host who is still connected as having left a healthy room', function () {
        $healthy = leftBehind(['status' => 'active', 'started_at' => now()->subMinutes(30)]);
        inCall($healthy, $this->host, joinedMinutesAgo: 30);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect($healthy->participants()->first()->left_at)->toBeNull()->and($healthy->participants()->first()->role)->toBe(RoomRole::Host);
    });
});
