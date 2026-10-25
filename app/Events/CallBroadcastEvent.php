<?php

namespace App\Events;

use Illuminate\Broadcasting\InteractsWithSockets;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Foundation\Events\Dispatchable;

/**
 * Base for events about a one-to-one call. They go to the private-user channel of each person
 * (every device of theirs hears it, so a second phone stops ringing when the first one answers).
 * The payload is `{ call: Call }`, built when the event is created.
 */
abstract class CallBroadcastEvent implements ShouldBroadcast
{
    use Dispatchable, InteractsWithSockets;

    /**
     * @param  array<string, mixed>  $payload
     * @param  list<string>  $userIds
     */
    public function __construct(public string $callId, public array $payload, public array $userIds)
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
