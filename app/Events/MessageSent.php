<?php

namespace App\Events;

class MessageSent extends ChatBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'message.sent';
    }
}
