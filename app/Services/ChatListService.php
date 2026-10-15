<?php

namespace App\Services;

use App\Enums\ChatType;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Device;
use App\Models\Message;
use App\Models\MessageEnvelope;
use App\Models\User;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Collection;

/**
 * Loads chats the way the API shows them to one user: latest message, unread count,
 * their own membership and (for direct chats) the other person.
 *
 * The number of queries does not depend on the number of chats on the page.
 */
class ChatListService
{
    /**
     * Most recently active chats first.
     */
    public function paginate(User $user, int $perPage, ?Device $device = null): CursorPaginator
    {
        $page = Chat::forUser($user)
            ->orderByDesc('chats.last_message_at')
            ->orderByDesc('chats.id')
            ->cursorPaginate($perPage)
            ->withQueryString();

        $this->hydrate($page->getCollection(), $user, $device);

        return $page;
    }

    /**
     * One chat in the same shape as a list row, plus its full member list.
     */
    public function find(User $user, Chat $chat, ?Device $device = null): Chat
    {
        $found = Chat::forUser($user)->whereKey($chat->getKey())->firstOrFail();

        $this->hydrate(new Collection([$found]), $user, $device);
        $found->load('chatMembers.user');

        return $found;
    }

    /**
     * @param  Collection<int, Chat>  $chats
     */
    private function hydrate(Collection $chats, User $user, ?Device $device = null): void
    {
        if ($chats->isEmpty()) {
            return;
        }

        $chats->load(['latestMessage.sender', 'latestMessage.attachment']);

        if ($device) {
            $this->attachOwnEnvelopes($chats, $device);
        }

        $memberships = ChatMember::query()
            ->where('user_id', $user->getKey())
            ->whereIn('chat_id', $chats->modelKeys())
            ->get()
            ->keyBy('chat_id');

        $directIds = $chats->filter(fn (Chat $chat) => $chat->type === ChatType::Direct)->modelKeys();

        $others = $directIds === [] ? collect() : ChatMember::query()
            ->whereIn('chat_id', $directIds)
            ->where('user_id', '!=', $user->getKey())
            ->with('user')
            ->get()
            ->keyBy('chat_id');

        foreach ($chats as $chat) {
            $chat->setRelation('myMembership', $memberships->get($chat->getKey()));

            if ($chat->type === ChatType::Direct) {
                $chat->setRelation('otherUser', $others->get($chat->getKey())?->user);
            }
        }
    }

    /**
     * When the caller names its device, give each encrypted latest message that device's own
     * envelope (one query), so a chat list can show previews. Other devices' envelopes are never loaded.
     *
     * @param  Collection<int, Chat>  $chats
     */
    private function attachOwnEnvelopes(Collection $chats, Device $device): void
    {
        $messages = $chats->map->latestMessage->filter(fn (?Message $message) => $message?->isEncrypted());

        if ($messages->isEmpty()) {
            return;
        }

        $envelopes = MessageEnvelope::query()
            ->where('recipient_device_id', $device->getKey())
            ->whereIn('message_id', $messages->modelKeys())
            ->get()
            ->groupBy('message_id');

        foreach ($messages as $message) {
            $message->setRelation('envelopes', $envelopes->get($message->getKey(), $message->newCollection()));
        }
    }
}
