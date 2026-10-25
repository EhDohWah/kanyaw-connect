<?php

namespace App\Actions\Calls;

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Exceptions\CallConflictException;
use App\Models\Call;

class CancelCall
{
    public function __construct(private FinishCall $finish) {}

    /**
     * The caller hangs up before it is answered: ringing → missed (cancelled), and the room is
     * closed. Cancelling a call that was already missed (cancelled, or rang out) returns it.
     *
     * @throws CallConflictException call_not_ringing: it was answered or declined
     */
    public function handle(Call $call): Call
    {
        $this->finish->handle($call, CallStatus::Missed, CallEndReason::Cancelled, [CallStatus::Ringing]);

        if ($call->status === CallStatus::Missed) {
            return $call;
        }

        throw CallConflictException::notRinging($call);
    }
}
