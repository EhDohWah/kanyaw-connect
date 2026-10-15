<?php

namespace App\Actions\Rooms;

use App\Enums\RoomAuditAction;
use App\Enums\RoomStatus;
use App\Models\Room;
use App\Models\User;
use App\Services\LiveKitService;
use App\Services\RoomAuditor;
use App\Services\RoomBroadcaster;
use Illuminate\Support\Facades\DB;

class EndRoom
{
    public function __construct(private LiveKitService $livekit, private RoomBroadcaster $broadcaster, private RoomAuditor $auditor) {}

    /**
     * End the meeting for everyone. Ending an ended room does nothing.
     *
     * LiveKit is told first: if it cannot be reached the room stays open and the host can retry,
     * rather than being marked ended while people are still connected.
     */
    public function handle(Room $room, User $actor): Room
    {
        if ($room->hasEnded()) {
            return $room;
        }

        $this->livekit->deleteRoom($room);

        $this->end($room, RoomAuditAction::Ended, $actor);

        return $room;
    }

    /**
     * End a room that was left behind (see EndStaleRooms). Not done by any person, so the audit entry
     * has no actor; `$reason` says which rule applied.
     */
    public function endStale(Room $room, string $reason): Room
    {
        if ($room->hasEnded()) {
            return $room;
        }

        $this->livekit->deleteRoom($room);

        $this->end($room, RoomAuditAction::AutoEnded, null, ['reason' => $reason]);

        return $room;
    }

    /**
     * @param  array<string, scalar|null>  $metadata
     */
    private function end(Room $room, RoomAuditAction $action, ?User $actor, array $metadata = []): void
    {
        // The audit entry is written together with the change; the broadcast only if this call ended it
        // (a webhook may have beaten us to it).
        $ended = DB::transaction(function () use ($room, $action, $actor, $metadata) {
            if (! $this->markEnded($room)) {
                return false;
            }

            $this->auditor->record($room, $action, $actor, null, $metadata);

            return true;
        });

        if ($ended) {
            $this->broadcaster->ended($room);
        }
    }

    /**
     * Mark the room ended and everyone who was connected as having left. Shared with the
     * room_finished webhook. Returns false if it was already ended.
     */
    public function markEnded(Room $room): bool
    {
        return DB::transaction(function () use ($room) {
            $locked = Room::whereKey($room->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->hasEnded()) {
                return false;
            }

            $now = now();
            $locked->update(['status' => RoomStatus::Ended, 'ended_at' => $now]);
            $locked->participants()
                ->whereNotNull('joined_at')->whereNull('left_at')
                ->update(['left_at' => Room::microseconds($now)]);
            $locked->participants()->update(['token_issued_at' => null]);

            $room->setRawAttributes($locked->getAttributes(), true);

            return true;
        });
    }
}
