<?php

namespace App\Services;

use App\Enums\CallStatus;
use App\Events\CallAccepted;
use App\Events\CallBroadcastEvent;
use App\Events\CallDeclined;
use App\Events\CallEnded;
use App\Events\CallIncoming;
use App\Events\CallMissed;
use App\Http\Resources\CallResource;
use App\Models\Call;
use Illuminate\Http\Request;

/**
 * Turns call changes into broadcast events on the private-user channels of the two people.
 * Callers invoke it after their transaction commits.
 */
class CallBroadcaster
{
    /** Only the callee hears it ring. */
    public function incoming(Call $call): void
    {
        $this->send(CallIncoming::class, $call, [$call->callee_id]);
    }

    public function accepted(Call $call): void
    {
        $this->send(CallAccepted::class, $call);
    }

    /** The call reached its final status: call.declined, call.missed or call.ended. */
    public function finished(Call $call): void
    {
        $event = match ($call->status) {
            CallStatus::Declined => CallDeclined::class,
            CallStatus::Missed => CallMissed::class,
            default => CallEnded::class,
        };

        $this->send($event, $call);
    }

    /**
     * @param  class-string<CallBroadcastEvent>  $event
     * @param  list<string>|null  $userIds  defaults to both people
     */
    private function send(string $event, Call $call, ?array $userIds = null): void
    {
        // Plain JSON data, resolved against an anonymous request (see ChatBroadcaster::resolve).
        $payload = json_decode(json_encode(['call' => CallResource::for($call)->resolve(Request::create('/'))]));

        event(new $event($call->getKey(), (array) $payload, $userIds ?? [$call->caller_id, $call->callee_id]));
    }
}
