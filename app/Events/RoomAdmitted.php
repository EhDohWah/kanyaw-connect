<?php

namespace App\Events;

class RoomAdmitted extends RoomBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'room.admitted';
    }
}
