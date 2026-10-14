<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PresenceChannel;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Base for events about one video room. Like ChatBroadcastEvent, the payload is plain data built
 * when the event is created. Room-wide events go to presence-room.{id}; events aimed at particular
 * people go to their private-user channel.
 */
abstract class RoomBroadcastEvent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param  array<string, mixed>  $payload
     * @param  list<string>  $userIds  also notify these users on their private-user channel
     * @param  bool  $toRoom  also send on the presence-room channel
     */
    public function __construct(
        public string $roomId,
        public array $payload,
        public array $userIds = [],
        public bool $toRoom = true,
    ) {
        $this->dontBroadcastToCurrentUser();
    }

    /**
     * @return list<PresenceChannel|PrivateChannel>
     */
    public function broadcastOn(): array
    {
        $channels = array_map(fn (string $id) => new PrivateChannel("user.{$id}"), $this->userIds);

        if ($this->toRoom) {
            array_unshift($channels, new PresenceChannel("room.{$this->roomId}"));
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
