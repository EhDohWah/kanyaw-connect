<?php

/*
| Cross-origin access for the separate frontend. Authentication uses bearer tokens, not cookies, so
| credentials are not allowed. Set CORS_ALLOWED_ORIGINS to the frontend origin(s), comma separated
| (it defaults to FRONTEND_URL).
*/
return [

    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CORS_ALLOWED_ORIGINS', env('FRONTEND_URL', 'http://localhost:5173'))),
    ))),

    'allowed_origins_patterns' => [],

    // X-Device-Id names the end-to-end encryption device making the request. X-Socket-ID is sent by
    // Laravel Echo so the server does not echo an event back to the connection that caused it.
    'allowed_headers' => ['Accept', 'Authorization', 'Content-Type', 'X-Requested-With', 'X-Device-Id', 'X-Socket-ID'],

    // Lets the frontend read how long to back off after a 429.
    'exposed_headers' => ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],

    // Browsers may cache a preflight answer for 10 minutes: fewer round trips on slow connections.
    'max_age' => 600,

    'supports_credentials' => false,

];
