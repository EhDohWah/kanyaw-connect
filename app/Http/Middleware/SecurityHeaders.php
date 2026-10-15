<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Defensive headers for an API that never serves web pages. A header the route already set (for
 * example the stricter Content-Security-Policy on attachment downloads) is left alone.
 *
 * Registered first in the global stack, so it also covers error responses and answers that other
 * middleware produce without reaching a controller.
 */
class SecurityHeaders
{
    private const DEFAULT_CACHE_CONTROL = 'no-cache, private';

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $headers = [
            // Never let a browser guess a type: responses are JSON or opaque files.
            'X-Content-Type-Options' => 'nosniff',
            // An API response is never meant to be shown in a frame or to load anything.
            'X-Frame-Options' => 'DENY',
            'Content-Security-Policy' => "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
            // Do not leak URLs (they can contain chat and room ids) to other sites.
            'Referrer-Policy' => 'no-referrer',
            'Permissions-Policy' => 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        ];

        foreach ($headers as $name => $value) {
            if (! $response->headers->has($name)) {
                $response->headers->set($name, $value);
            }
        }

        $hsts = config('security.hsts');

        if ($hsts['enabled'] && $request->isSecure() && ! $response->headers->has('Strict-Transport-Security')) {
            $response->headers->set('Strict-Transport-Security', 'max-age='.$hsts['max_age'].($hsts['include_subdomains'] ? '; includeSubDomains' : ''));
        }

        // Responses hold private conversations: keep them out of disk caches on shared devices.
        // (Laravel's default is "no-cache, private", which still allows storing; routes that set
        // their own Cache-Control, such as attachment downloads, are not touched.)
        if ($response->headers->get('Cache-Control') === self::DEFAULT_CACHE_CONTROL) {
            $response->headers->set('Cache-Control', 'no-store, private');
        }

        return $response;
    }
}
