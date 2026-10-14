<?php

namespace App\Actions\Chats;

use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class MarkChatRead
{
    /**
     * Move the user's read position up to the given message. It never moves backwards,
     * so a slow client sending an older message id cannot make read messages unread again.
     */
    public function handle(Chat $chat, User $user, string $messageId): ChatMember
    {
        return DB::transaction(function () use ($chat, $user, $messageId) {
            $membership = $chat->chatMembers()->where('user_id', $user->getKey())->lockForUpdate()->firstOrFail();
            $message = Message::withTrashed()->where('chat_id', $chat->getKey())->findOrFail($messageId);

            if (! $membership->last_read_at || $message->created_at->gt($membership->last_read_at)) {
                $membership->update([
                    'last_read_message_id' => $message->getKey(),
                    'last_read_at' => $message->created_at,
                ]);
            }

            return $membership;
        });
    }
}
