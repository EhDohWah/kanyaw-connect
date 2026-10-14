<?php

namespace App\Events;

class ChatMemberRemoved extends ChatBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'chat.member_removed';
    }
}
