<?php

namespace App\Actions\Rooms;

use App\Exceptions\RoomConflictException;
use App\Models\Room;

class SetRoomLock
{
    /**
     * A locked room turns away new people. Anyone already admitted can still reconnect.
     *
     * @throws RoomConflictException when the room has ended
     */
    public function handle(Room $room, bool $locked): Room
    {
        if ($room->hasEnded()) {
            throw RoomConflictException::ended();
        }

        $room->update(['is_locked' => $locked]);

        return $room;
    }
}
