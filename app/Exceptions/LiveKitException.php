<?php

namespace App\Exceptions;

use RuntimeException;
use Throwable;

/**
 * LiveKit could not be reached or rejected a request. Rendered as 503 so clients can retry.
 */
class LiveKitException extends RuntimeException
{
    public static function from(Throwable $previous): self
    {
        return new self('The video service is unavailable. Please try again.', 0, $previous);
    }
}
