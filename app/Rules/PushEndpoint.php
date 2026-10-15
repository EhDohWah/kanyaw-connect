<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The URL of a browser's push service. The server will POST to it, so it must be one of the known
 * push services (config push.allowed_hosts): anything else would let a signed-in user aim the server
 * at any address it can reach, including internal ones (server-side request forgery).
 */
class PushEndpoint implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! $this->isAcceptable($value)) {
            $fail('The :attribute must be the https URL of a supported browser push service.');
        }
    }

    private function isAcceptable(mixed $value): bool
    {
        // RFC 3986 characters only, which rules out backslashes, spaces and control characters that
        // different URL parsers read differently. '@' (credentials) and '#' (fragment) never occur
        // in a push endpoint.
        if (! is_string($value) || strlen($value) > 2048 || ! preg_match('#^[A-Za-z0-9\-._~:/?\[\]!$&\'()*+,;=%]+$#', $value)) {
            return false;
        }

        $parts = parse_url($value);

        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            return false;
        }

        $requireHttps = config('push.require_https');
        $scheme = strtolower($parts['scheme']);

        if ($requireHttps ? $scheme !== 'https' : ! in_array($scheme, ['http', 'https'], true)) {
            return false;
        }

        // Real push services use the default port. (Plain-http testing may use any.)
        if ($requireHttps && isset($parts['port']) && $parts['port'] !== 443) {
            return false;
        }

        return $this->hostIsAllowed(strtolower($parts['host']));
    }

    private function hostIsAllowed(string $host): bool
    {
        foreach (config('push.allowed_hosts') as $allowed) {
            $allowed = strtolower($allowed);

            if (str_starts_with($allowed, '*.')) {
                if (str_ends_with($host, substr($allowed, 1))) {
                    return true;
                }
            } elseif ($host === $allowed) {
                return true;
            }
        }

        return false;
    }
}
