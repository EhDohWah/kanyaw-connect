<?php

namespace App\Actions\Calls;

use App\Enums\CallStatus;
use App\Exceptions\CallConflictException;
use App\Models\Call;

class DeclineCall
{
    public function __construct(private FinishCall $finish) {}

    /**
     * The callee says no: ringing → declined, and the room is closed. Declining again returns the
     * declined call.
     *
     * @throws CallConflictException call_not_ringing: it was answered, cancelled or missed
     */
    public function handle(Call $call): Call
    {
        $this->finish->handle($call, CallStatus::Declined, null, [CallStatus::Ringing]);

        if ($call->status === CallStatus::Declined) {
            return $call;
        }

        throw CallConflictException::notRinging($call);
    }
}
