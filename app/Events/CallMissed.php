<?php

namespace App\Events;

class CallMissed extends CallBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'call.missed';
    }
}
