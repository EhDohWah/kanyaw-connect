<?php

use App\Models\ChatMember;
use App\Models\User;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Str;

/*
| Channel authorization. Clients authenticate with their bearer token against
| POST /api/v1/broadcasting/auth.
|
| Laravel strips the "private-" / "presence-" prefix before matching, so each pattern below
| covers both flavours of the channel. A callback returns false (denied) or, for presence
| channels, the public info other members will see. Never return email or phone here.
|
|   private-user.{userId}    notifications for one user (all their devices)
|   private-chat.{chatId}    events of one chat, for members who have it open
|   presence-chat.{chatId}   same members; also tells who is currently in the chat and carries
|                            typing indicators (client whispers, no server endpoint)
|
| presence-room.{roomId} (video rooms) is added in Phase 4, with the rooms table.
*/

Broadcast::channel('user.{userId}', fn (User $user, string $userId) => $user->getKey() === $userId);

Broadcast::channel('chat.{chatId}', function (User $user, string $chatId) {
    // Channel names come from the client: reject anything that is not a UUID before it reaches Postgres.
    if (! Str::isUuid($chatId)) {
        return false;
    }

    $isMember = ChatMember::where('chat_id', $chatId)->where('user_id', $user->getKey())->exists();

    return $isMember ? [
        'id' => $user->getKey(),
        'name' => $user->name,
        'avatar_url' => $user->avatar_thumb_url,
    ] : false;
});
