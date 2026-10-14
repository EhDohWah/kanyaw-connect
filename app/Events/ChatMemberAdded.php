<?php

namespace App\Events;

class ChatMemberAdded extends ChatBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'chat.member_added';
    }
}
