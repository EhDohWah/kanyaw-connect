<?php

namespace App\Events;

class MessageRead extends ChatBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'message.read';
    }
}
