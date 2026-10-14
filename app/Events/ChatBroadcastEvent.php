<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Base for events about one chat. Dispatch through ChatBroadcaster::send(), which splits big
 * audiences into several events.
 *
 * The payload is built (from API Resources) when the event is created, not when the queue
 * worker runs it, so the worker needs no database access and never sees a half-deleted model.
 */
abstract class ChatBroadcastEvent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param  array<string, mixed>  $payload  sent to clients as the event data
     * @param  list<string>  $userIds  also notify these users on their private-user channel
     * @param  bool  $toChat  also send on the private-chat channel
     */
    public function __construct(
        public string $chatId,
        public array $payload,
        public array $userIds = [],
        public bool $toChat = true,
    ) {
        // The device that caused the event already knows about it (it sent X-Socket-ID);
        // the user's other devices still receive it.
        $this->dontBroadcastToCurrentUser();
    }

    /**
     * @return list<PrivateChannel>
     */
    public function broadcastOn(): array
    {
        $channels = array_map(fn (string $id) => new PrivateChannel("user.{$id}"), $this->userIds);

        if ($this->toChat) {
            array_unshift($channels, new PrivateChannel("chat.{$this->chatId}"));
        }

        return $channels;
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return $this->payload;
    }
}
