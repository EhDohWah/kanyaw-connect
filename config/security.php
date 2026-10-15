<?php

return [

    /*
    | Strict-Transport-Security. Only ever sent on HTTPS requests, so it is harmless in local
    | development over plain HTTP. Behind a TLS-terminating proxy, set TRUSTED_PROXIES so Laravel
    | can tell the original request was HTTPS.
    */
    'hsts' => [
        'enabled' => (bool) env('SECURITY_HSTS', true),
        'max_age' => 31536000, // one year
        'include_subdomains' => true,
    ],

    /*
    | Proxies whose X-Forwarded-* headers are trusted: "*" (any; only safe when the app is reachable
    | solely through your proxy), or a comma separated list of IPs / CIDR ranges. Leave empty when
    | the app is exposed directly.
    |
    | This matters for more than HSTS: rate limiting by IP, and the signed attachment URLs (the
    | signature covers the scheme and host), are wrong behind a proxy that is not trusted.
    */
    'trusted_proxies' => env('TRUSTED_PROXIES'),

    /*
    | Flood backstop for signed-in clients, per user per minute, on top of the stricter per-action
    | limits (login, messages, joins, ...).
    */
    'api_rate_limit_per_minute' => (int) env('API_RATE_LIMIT', 300),

    /*
    | Account creation attempts per hour per IP address.
    */
    'register_rate_limit_per_hour' => (int) env('REGISTER_RATE_LIMIT', 20),

];
