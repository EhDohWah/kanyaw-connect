<?php

namespace App\Events;

class MessageUpdated extends ChatBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'message.updated';
    }
}
