<?php

namespace App\Events;

class CallEnded extends CallBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'call.ended';
    }
}
