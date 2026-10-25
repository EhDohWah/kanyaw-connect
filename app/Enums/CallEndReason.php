<?php

namespace App\Enums;

/** Why a call stopped. Declined calls have none: the status says it. */
enum CallEndReason: string
{
    /** One of the two pressed "end" during the call. */
    case HungUp = 'hung_up';
    /** A connection dropped and did not come back in time, or LiveKit closed the room. */
    case ConnectionLost = 'connection_lost';
    /** The caller gave up before it was answered (status missed). */
    case Cancelled = 'cancelled';
    /** Nobody answered before the ringing ran out (status missed). */
    case NoAnswer = 'no_answer';
}
