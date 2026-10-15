<?php

/*
| Scheduled housekeeping (see routes/console.php; needs `php artisan schedule:work` or a cron entry).
*/
return [

    // Deleting a message only hides it (soft delete). It is removed for good after this many days.
    'deleted_messages_days' => (int) env('CLEANUP_DELETED_MESSAGES_DAYS', 30),

    // An upload that was never attached to a message is thrown away after this many hours.
    'orphan_attachment_hours' => (int) env('CLEANUP_ORPHAN_ATTACHMENT_HOURS', 24),

    /*
    | Rooms that were left behind. LiveKit's webhooks normally end a room, but a missed webhook (the
    | API was down) would otherwise leave it "active" for ever.
    */
    'stale_rooms' => [
        // Never started: this long after it was due (scheduled time plus its duration, or creation for instant rooms).
        'never_started_hours' => 24,
        // Started, but nobody has been connected for this long.
        'empty_active_minutes' => 60,
        // Started longer ago than this: over, whatever the webhooks said.
        'max_active_hours' => 24,
    ],

    // Rows handled per database round trip.
    'chunk_size' => 200,

];
