<?php

namespace App\Enums;

/** What came of sending one push notification to one browser. */
enum PushOutcome
{
    /** The push service accepted it. */
    case Sent;

    /** The push service says the subscription is gone (404 / 410): the browser unsubscribed or was reset. */
    case Expired;

    /** A temporary problem (timeout, 429, 5xx, ...): worth trying again shortly. */
    case Failed;
}
