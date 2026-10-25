<?php

namespace App\Jobs;

use App\Actions\Calls\FinishCall;
use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Models\Call;
use App\Models\RoomParticipant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Dispatched with a delay of calls.reconnect_grace_seconds when someone drops out of an answered
 * call. If they are still gone by then, the call ends (connection_lost). Does nothing if they came
 * back, if the call ended meanwhile, or if they dropped out again later (that drop has its own job).
 */
class EndCallAfterGrace implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(public string $callId, public string $userId) {}

    public function handle(FinishCall $finish): void
    {
        $call = Call::find($this->callId);

        if ($call?->status !== CallStatus::Ongoing) {
            return;
        }

        $participant = RoomParticipant::where('room_id', $call->room_id)->where('user_id', $this->userId)->first();
        $graceStart = now()->subSeconds(config('calls.reconnect_grace_seconds'));

        if (! $participant || $participant->isPresent() || $participant->left_at?->greaterThan($graceStart)) {
            return;
        }

        $finish->handle($call, CallStatus::Ended, CallEndReason::ConnectionLost, [CallStatus::Ongoing]);
    }
}
