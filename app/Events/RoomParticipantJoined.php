<?php

namespace App\Events;

class RoomParticipantJoined extends RoomBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'room.participant_joined';
    }
}
