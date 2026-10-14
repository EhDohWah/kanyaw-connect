<?php

namespace App\Actions\Chats;

use App\Models\Chat;

class UpdateChat
{
    /**
     * @param  array{name?: string, description?: string|null}  $data
     */
    public function handle(Chat $chat, array $data): Chat
    {
        $chat->fill($data)->save();

        return $chat;
    }
}
