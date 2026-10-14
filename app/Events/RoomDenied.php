<?php

namespace App\Events;

class RoomDenied extends RoomBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'room.denied';
    }
}
