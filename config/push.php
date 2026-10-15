<?php

/*
| Web push notifications ("New message" on a phone whose app is closed).
|
| The browser gives the frontend a push subscription; the frontend registers it with
| POST /api/v1/push/subscriptions. The server sends encrypted payloads to the browser's push service
| (Google, Mozilla, Apple, ...), which cannot read them. Create the VAPID keys once with
| `php artisan push:vapid`. Push stays switched off until both keys are set.
*/
return [

    'vapid' => [
        // A mailto: or https: contact the push services can reach if your server misbehaves.
        'subject' => env('VAPID_SUBJECT', 'mailto:'.env('MAIL_FROM_ADDRESS', 'noreply@example.com')),
        'public_key' => env('VAPID_PUBLIC_KEY'),
        'private_key' => env('VAPID_PRIVATE_KEY'),
    ],

    /*
    | How long a push service keeps a notification for a phone that is switched off or offline.
    | A chat notification is useless after a day; the app shows the message itself when opened.
    */
    'ttl_seconds' => (int) env('PUSH_TTL', 86400),

    // very-low | low | normal | high. Chat messages are "high": mobile OSes may delay lower urgencies.
    'urgency' => env('PUSH_URGENCY', 'high'),

    /*
    | Plaintext chats only: show who wrote and the first words of the message. Turn off to show just
    | "New message". Encrypted chats never show anything but "New message", whatever this says.
    */
    'show_preview' => (bool) env('PUSH_SHOW_PREVIEW', true),
    'preview_length' => 100,

    // Do not push to people with a live heartbeat: the app is open and gets the message over the websocket.
    'skip_online_users' => (bool) env('PUSH_SKIP_ONLINE', true),

    'max_subscriptions_per_user' => 20,

    'timeout_seconds' => 10,

    /*
    | The server connects to the endpoint URL a client registers, so unrestricted URLs would let any
    | signed-in user make the server call arbitrary addresses (including ones inside your network).
    | Only the push services of the major browsers are accepted. "*.example.com" matches any
    | subdomain. Extend with PUSH_ALLOWED_HOSTS (comma separated) if a browser you support uses another.
    */
    'allowed_hosts' => array_values(array_filter(array_map('trim', explode(',', (string) env('PUSH_ALLOWED_HOSTS', implode(',', [
        'fcm.googleapis.com',                // Chrome, Edge, Brave, Opera, Samsung Internet, Android
        'updates.push.services.mozilla.com', // Firefox
        '*.push.services.mozilla.com',
        'web.push.apple.com',                // Safari, iOS home-screen apps
        '*.push.apple.com',
        '*.notify.windows.com',              // Windows push service
    ])))))),

    // Endpoints must be https. Only switch off for local testing against a plain-http fake push service.
    'require_https' => (bool) env('PUSH_REQUIRE_HTTPS', true),

];
