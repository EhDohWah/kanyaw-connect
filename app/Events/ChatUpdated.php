<?php

namespace App\Events;

class ChatUpdated extends ChatBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'chat.updated';
    }
}
