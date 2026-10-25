<?php

namespace App\Jobs;

use App\Actions\Calls\FinishCall;
use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Models\Call;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Dispatched with a delay when a call starts: if nobody answered by ring_expires_at, the call was
 * missed (no_answer). Does nothing for a call that was answered, declined or cancelled meanwhile,
 * or if it runs early (a queue without delays, such as the sync driver in tests).
 */
class ExpireRingingCall implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(public string $callId) {}

    public function handle(FinishCall $finish): void
    {
        $call = Call::find($this->callId);

        if ($call?->status === CallStatus::Ringing && $call->ringExpired()) {
            $finish->handle($call, CallStatus::Missed, CallEndReason::NoAnswer, [CallStatus::Ringing]);
        }
    }
}
