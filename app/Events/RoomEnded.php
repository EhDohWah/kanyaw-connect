<?php

namespace App\Events;

class RoomEnded extends RoomBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'room.ended';
    }
}
