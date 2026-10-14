<?php

return [

    /*
    | Maximum members in one group chat (including the owner).
    */
    'max_group_members' => 256,

    /*
    | Messages can only be edited by their sender for this many hours after sending.
    */
    'edit_window_hours' => 24,

    /*
    | Page size for cursor-paginated lists.
    */
    'default_per_page' => 30,
    'max_per_page' => 100,

    /*
    | Attachments are private: they live on a non-public disk and are served through
    | short-lived signed URLs.
    */
    'attachments' => [
        'disk' => env('CHAT_ATTACHMENTS_DISK', 'local'),
        'max_kilobytes' => 25 * 1024,
        'url_ttl_minutes' => 60,
        'thumbnail_size' => 400,
    ],

    /*
    | Presence: a client heartbeat keeps a cache key alive for this many seconds. When the key is
    | gone (no heartbeat for that long) the user counts as offline.
    */
    'presence' => [
        'ttl_seconds' => 90,
        'max_lookup' => 100,
    ],

];
