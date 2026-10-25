<?php

namespace App\Actions\Calls;

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Exceptions\CallConflictException;
use App\Models\Call;

class EndCall
{
    public function __construct(private FinishCall $finish) {}

    /**
     * Either person hangs up an answered call: ongoing → ended (hung_up), and the room is closed.
     * Ending a call that has already ended (by the other person, or a lost connection) returns it.
     *
     * @throws CallConflictException call_not_ongoing: it is still ringing (cancel or decline it), or never was answered
     */
    public function handle(Call $call): Call
    {
        $this->finish->handle($call, CallStatus::Ended, CallEndReason::HungUp, [CallStatus::Ongoing]);

        if ($call->status === CallStatus::Ended) {
            return $call;
        }

        throw CallConflictException::notOngoing($call);
    }
}
