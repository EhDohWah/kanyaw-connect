<?php

namespace App\Events;

class RoomRoleChanged extends RoomBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'room.role_changed';
    }
}
