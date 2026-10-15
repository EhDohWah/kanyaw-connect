<?php

namespace App\Actions\Rooms;

use App\Enums\RoomAuditAction;
use App\Exceptions\RoomConflictException;
use App\Models\Room;
use App\Models\User;
use App\Services\RoomAuditor;
use Illuminate\Support\Facades\DB;

class SetRoomLock
{
    public function __construct(private RoomAuditor $auditor) {}

    /**
     * A locked room turns away new people. Anyone already admitted can still reconnect.
     *
     * @throws RoomConflictException when the room has ended
     */
    public function handle(Room $room, bool $locked, User $actor): Room
    {
        if ($room->hasEnded()) {
            throw RoomConflictException::ended();
        }

        if ($room->is_locked !== $locked) {
            DB::transaction(function () use ($room, $locked, $actor) {
                $room->update(['is_locked' => $locked]);
                $this->auditor->record($room, $locked ? RoomAuditAction::Locked : RoomAuditAction::Unlocked, $actor);
            });
        }

        return $room;
    }
}
