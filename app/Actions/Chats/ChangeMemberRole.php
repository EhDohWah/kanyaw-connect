<?php

namespace App\Actions\Chats;

use App\Enums\ChatRole;
use App\Models\Chat;
use App\Models\User;

class ChangeMemberRole
{
    public function handle(Chat $chat, User $target, ChatRole $role): void
    {
        $chat->chatMembers()->where('user_id', $target->getKey())->update(['role' => $role]);
    }
}
