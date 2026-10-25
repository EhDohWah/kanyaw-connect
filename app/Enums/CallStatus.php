<?php

namespace App\Enums;

/** Where a call is. Ringing and ongoing are "active": a person can be in one active call at a time. */
enum CallStatus: string
{
    case Ringing = 'ringing';
    case Ongoing = 'ongoing';
    case Ended = 'ended';
    case Declined = 'declined';
    case Missed = 'missed';

    /** @return list<string> */
    public static function activeValues(): array
    {
        return [self::Ringing->value, self::Ongoing->value];
    }

    public function isActive(): bool
    {
        return in_array($this->value, self::activeValues(), true);
    }
}
