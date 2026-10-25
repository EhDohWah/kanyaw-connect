<?php

namespace App\Events;

class CallDeclined extends CallBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'call.declined';
    }
}
