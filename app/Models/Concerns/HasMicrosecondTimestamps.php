<?php

namespace App\Models\Concerns;

use Carbon\CarbonInterface;

/**
 * Store and read timestamps with microsecond precision.
 *
 * Chat ordering, unread counts and read positions compare messages sent within the same second,
 * so the tables behind these models use timestamp(6). Laravel would still drop the fraction in
 * three places, which this trait (and its callers) deal with:
 *
 *  1. Writing a model: Laravel formats dates as "Y-m-d H:i:s". Fixed by getDateFormat() below.
 *  2. Cursor pagination: the paginator puts (string) $date into the cursor. Fixed by asDateTime(),
 *     which makes dates from these models print with microseconds.
 *  3. A DateTime passed as a query *binding* or to a query-builder update() is formatted by the
 *     query grammar, without microseconds. Not fixable here: pass microseconds($date) instead.
 */
trait HasMicrosecondTimestamps
{
    public const MICROSECOND_FORMAT = 'Y-m-d H:i:s.u';

    public function getDateFormat(): string
    {
        return self::MICROSECOND_FORMAT;
    }

    protected function asDateTime($value)
    {
        return parent::asDateTime($value)->settings(['toStringFormat' => self::MICROSECOND_FORMAT]);
    }

    /** A date as a string that keeps its microseconds, for query bindings and query-builder updates. */
    public static function microseconds(CarbonInterface $date): string
    {
        return $date->format(self::MICROSECOND_FORMAT);
    }
}
