<?php

namespace App\Actions\Chats;

use App\Models\Chat;
use App\Services\ChatBroadcaster;

class UpdateChat
{
    public function __construct(private ChatBroadcaster $broadcaster) {}

    /**
     * @param  array{name?: string, description?: string|null}  $data
     */
    public function handle(Chat $chat, array $data): Chat
    {
        $chat->fill($data)->save();

        if ($chat->wasChanged()) {
            $this->broadcaster->chatUpdated($chat);
        }

        return $chat;
    }
}
