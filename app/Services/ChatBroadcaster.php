<?php

namespace App\Services;

use App\Events\ChatBroadcastEvent;
use App\Events\ChatMemberAdded;
use App\Events\ChatMemberRemoved;
use App\Events\ChatUpdated;
use App\Events\MessageDeleted;
use App\Events\MessageRead;
use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Http\Resources\ChatSummaryResource;
use App\Http\Resources\MessageResource;
use App\Http\Resources\PublicUserResource;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Message;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Turns domain changes into broadcast events. Actions call this after their transaction commits.
 *
 * Who hears what:
 *  - private-chat.{id}: members who have that chat open (they subscribe to it).
 *  - private-user.{id}: every member's always-on channel, for chats they have NOT opened
 *    (new messages, new chats, being removed). Clients that listen on both receive some events
 *    twice and should de-duplicate by message id.
 */
class ChatBroadcaster
{
    /** The Pusher protocol allows at most 100 channels per published event. */
    private const MAX_CHANNELS_PER_EVENT = 100;

    public function messageSent(Message $message): void
    {
        $this->send(MessageSent::class, $message->chat_id, $this->messagePayload($message), $this->memberIds($message->chat_id));
    }

    public function messageUpdated(Message $message): void
    {
        $this->send(MessageUpdated::class, $message->chat_id, $this->messagePayload($message));
    }

    public function messageDeleted(Message $message): void
    {
        $this->send(MessageDeleted::class, $message->chat_id, [
            'chat_id' => $message->chat_id,
            'message_id' => $message->getKey(),
        ]);
    }

    /** Also goes to the reader's own user channel so their other devices clear the unread badge. */
    public function messageRead(Chat $chat, ChatMember $membership): void
    {
        $this->send(MessageRead::class, $chat->getKey(), [
            'chat_id' => $chat->getKey(),
            'user_id' => $membership->user_id,
            'last_read_message_id' => $membership->last_read_message_id,
            'last_read_at' => $membership->last_read_at,
        ], [$membership->user_id]);
    }

    public function chatUpdated(Chat $chat): void
    {
        $this->send(ChatUpdated::class, $chat->getKey(), [
            'chat' => $this->resolve(new ChatSummaryResource($chat)),
        ], $this->memberIds($chat->getKey()));
    }

    /**
     * Existing members hear it on the chat channel; the new member on their user channel.
     * For a brand-new chat, every member except the creator gets this on their user channel
     * (with $toChat false, because nobody has the chat channel open yet).
     */
    public function memberAdded(Chat $chat, User $user, bool $toChat = true): void
    {
        $this->send(ChatMemberAdded::class, $chat->getKey(), [
            'chat' => $this->resolve(new ChatSummaryResource($chat)),
            'user' => $this->resolve(new PublicUserResource($user)),
        ], [$user->getKey()], $toChat);
    }

    public function memberRemoved(Chat $chat, string $userId): void
    {
        $this->send(ChatMemberRemoved::class, $chat->getKey(), [
            'chat_id' => $chat->getKey(),
            'user_id' => $userId,
        ], [$userId]);
    }

    /**
     * Dispatch one event, or several when more than 100 channels are needed.
     *
     * @param  class-string<ChatBroadcastEvent>  $event
     * @param  array<string, mixed>  $payload
     * @param  list<string>  $userIds
     */
    private function send(string $event, string $chatId, array $payload, array $userIds = [], bool $toChat = true): void
    {
        $chunks = array_chunk($userIds, self::MAX_CHANNELS_PER_EVENT - 1) ?: [[]];

        foreach ($chunks as $i => $chunk) {
            $withChat = $toChat && $i === 0;

            if ($chunk !== [] || $withChat) {
                event(new $event($chatId, $payload, $chunk, $withChat));
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function messagePayload(Message $message): array
    {
        $message->loadMissing(['sender', 'replyTo', 'attachment']);

        return ['message' => $this->resolve(new MessageResource($message))];
    }

    /**
     * Resolve a resource to plain JSON data (no models, enums or nested resources, so it queues
     * cleanly). It is resolved against an anonymous request so nothing specific to whoever caused
     * the event, such as the sender's client_id, ends up in a payload every member receives.
     * Objects (not arrays) are kept so an empty JSON object such as metadata stays {}.
     */
    private function resolve(JsonResource $resource): object
    {
        return json_decode(json_encode($resource->resolve(Request::create('/'))));
    }

    /**
     * @return list<string>
     */
    private function memberIds(string $chatId): array
    {
        return ChatMember::where('chat_id', $chatId)->pluck('user_id')->all();
    }
}
