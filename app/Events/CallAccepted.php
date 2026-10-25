<?php

namespace App\Events;

class CallAccepted extends CallBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'call.accepted';
    }
}
