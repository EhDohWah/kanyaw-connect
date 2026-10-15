<?php

namespace App\Actions\Rooms;

use App\Enums\RoomStatus;
use App\Exceptions\LiveKitException;
use App\Models\Room;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Log;

class EndStaleRooms
{
    public function __construct(private EndRoom $endRoom) {}

    /**
     * End rooms that were left behind (see config/cleanup.php). Each goes through EndRoom, so
     * LiveKit is told to close it, everyone still listed as connected is marked as having left, and
     * `room.ended` is broadcast.
     *
     * If LiveKit cannot be reached the room is left as it is and picked up again on the next run.
     *
     * @return array{never_started: int, empty: int, too_long: int, failed: int}
     */
    public function handle(): array
    {
        $result = ['never_started' => 0, 'empty' => 0, 'too_long' => 0, 'failed' => 0];

        $rules = [
            'never_started' => fn () => $this->neverStarted(),
            'empty' => fn () => $this->emptyAfterStarting(),
            'too_long' => fn () => $this->startedTooLongAgo(),
        ];

        foreach ($rules as $reason => $query) {
            $query()->chunkById(config('cleanup.chunk_size'), function (Collection $rooms) use ($reason, $query, &$result) {
                foreach ($rooms as $room) {
                    // Look again right before ending: someone may have joined since the list was read.
                    if (! $query()->whereKey($room->getKey())->exists()) {
                        continue;
                    }

                    try {
                        $this->endRoom->endStale($room, $reason);
                        $result[$reason]++;
                    } catch (LiveKitException $e) {
                        $result['failed']++;
                        Log::warning('Could not end a stale room because LiveKit is unavailable; it will be retried.', ['room' => $room->getKey()]);
                    }
                }
            });
        }

        return $result;
    }

    /**
     * Nobody ever joined, and it is long past when it was due: a scheduled room's start plus its
     * length, or the creation time of an instant one.
     *
     * @return Builder<Room>
     */
    private function neverStarted(): Builder
    {
        $cutoff = Room::microseconds(now()->subHours(config('cleanup.stale_rooms.never_started_hours')));

        return Room::query()
            ->where('status', RoomStatus::Waiting->value)
            ->whereRaw('coalesce(rooms.scheduled_at, rooms.created_at) + make_interval(mins => coalesce(rooms.duration_minutes, 0)) < ?', [$cutoff]);
    }

    /**
     * Started, but nobody is connected and nobody has been for a while. LiveKit closes an empty room
     * after a few minutes and tells us; this catches the case where that webhook never arrived.
     *
     * @return Builder<Room>
     */
    private function emptyAfterStarting(): Builder
    {
        $cutoff = Room::microseconds(now()->subMinutes(config('cleanup.stale_rooms.empty_active_minutes')));

        return Room::query()
            ->where('status', RoomStatus::Active->value)
            ->whereRaw('not exists (select 1 from room_participants p where p.room_id = rooms.id and p.joined_at is not null and p.left_at is null)')
            ->whereRaw('coalesce((select max(p.left_at) from room_participants p where p.room_id = rooms.id), rooms.started_at) < ?', [$cutoff]);
    }

    /**
     * No meeting lasts this long: anything still "active" is a ghost of a missed webhook.
     *
     * @return Builder<Room>
     */
    private function startedTooLongAgo(): Builder
    {
        return Room::query()
            ->where('status', RoomStatus::Active->value)
            ->where('started_at', '<', Room::microseconds(now()->subHours(config('cleanup.stale_rooms.max_active_hours'))));
    }
}
