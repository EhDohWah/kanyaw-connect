<?php

namespace App\Events;

class MessageDeleted extends ChatBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'message.deleted';
    }
}
