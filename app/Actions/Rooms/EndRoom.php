<?php

namespace App\Actions\Rooms;

use App\Enums\RoomStatus;
use App\Models\Room;
use App\Services\LiveKitService;
use App\Services\RoomBroadcaster;
use Illuminate\Support\Facades\DB;

class EndRoom
{
    public function __construct(private LiveKitService $livekit, private RoomBroadcaster $broadcaster) {}

    /**
     * End the meeting for everyone. Ending an ended room does nothing.
     *
     * LiveKit is told first: if it cannot be reached the room stays open and the host can retry,
     * rather than being marked ended while people are still connected.
     */
    public function handle(Room $room): Room
    {
        if ($room->hasEnded()) {
            return $room;
        }

        $this->livekit->deleteRoom($room);

        $this->markEnded($room);

        $this->broadcaster->ended($room);

        return $room;
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
