<?php

namespace App\Events;

class RoomJoinRequested extends RoomBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'room.join_requested';
    }
}
