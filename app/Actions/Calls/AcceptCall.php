<?php

namespace App\Actions\Calls;

use App\Actions\Push\NotifyCallParties;
use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Exceptions\CallConflictException;
use App\Models\Call;
use App\Services\CallBroadcaster;
use Illuminate\Support\Facades\DB;

class AcceptCall
{
    public function __construct(private FinishCall $finish, private CallBroadcaster $broadcaster, private NotifyCallParties $notifier) {}

    /**
     * The callee answers: ringing → ongoing. Accepting a call that is already ongoing (answered on
     * the callee's other device) returns it as it is.
     *
     * @throws CallConflictException call_not_ringing: it was declined, cancelled or missed
     */
    public function handle(Call $call): Call
    {
        $accepted = DB::transaction(function () use ($call) {
            $locked = Call::whereKey($call->getKey())->lockForUpdate()->firstOrFail();

            $ringing = $locked->status === CallStatus::Ringing && ! $locked->ringExpired();

            if ($ringing) {
                $locked->update(['status' => CallStatus::Ongoing, 'answered_at' => now()]);
            }

            $call->setRawAttributes($locked->getAttributes(), true);

            return $ringing;
        });

        if ($accepted) {
            $this->broadcaster->accepted($call);
            // Answered on one device: the callee's other phones stop ringing.
            $this->notifier->ringingOver($call);

            return $call;
        }

        // Too late: if the ringing ran out a moment ago and the timeout job has not run yet,
        // record the miss now so the answer below is final.
        $this->finish->handle($call, CallStatus::Missed, CallEndReason::NoAnswer, [CallStatus::Ringing]);

        if ($call->status === CallStatus::Ongoing) {
            return $call;
        }

        throw CallConflictException::notRinging($call);
    }
}
