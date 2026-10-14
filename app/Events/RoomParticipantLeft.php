<?php

namespace App\Events;

class RoomParticipantLeft extends RoomBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'room.participant_left';
    }
}
