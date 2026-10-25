<?php

namespace App\Exceptions;

use App\Models\Call;
use RuntimeException;

/**
 * A call request that is valid but not possible right now (someone is busy, the call already
 * moved on). Rendered as { message, code } and, when there is one, the call as it is now, so the
 * app can show what happened instead of asking again.
 */
class CallConflictException extends RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message, public readonly ?Call $call = null, public readonly int $status = 409)
    {
        parent::__construct($message);
    }

    public static function alreadyInCall(): self
    {
        return new self('already_in_call', 'You are already in a call.');
    }

    public static function calleeBusy(): self
    {
        return new self('callee_busy', 'They are in another call.');
    }

    /** Accept, decline or cancel came too late: answered elsewhere, declined, cancelled or missed. */
    public static function notRinging(Call $call): self
    {
        return new self('call_not_ringing', 'This call is no longer ringing.', $call);
    }

    /** End on a call that was never answered, or ended differently. */
    public static function notOngoing(Call $call): self
    {
        return new self('call_not_ongoing', 'This call is not in progress.', $call);
    }
}
