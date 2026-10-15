<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Base for events about a user's devices, sent to the private-user channels of everyone who needs to
 * react (their contacts' clients re-key; their own other devices update). Payloads carry ids only.
 */
abstract class DeviceBroadcastEvent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param  array<string, mixed>  $payload
     * @param  list<string>  $userIds
     */
    public function __construct(public array $payload, public array $userIds)
    {
        $this->dontBroadcastToCurrentUser();
    }

    /**
     * @return list<PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return array_map(fn (string $id) => new PrivateChannel("user.{$id}"), $this->userIds);
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return $this->payload;
    }
}
