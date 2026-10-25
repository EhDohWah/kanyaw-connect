<?php

namespace App\Events;

class CallIncoming extends CallBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'call.incoming';
    }
}
