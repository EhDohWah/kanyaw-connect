<?php

namespace App\Http\Middleware;

use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Support\Str;

/**
 * Laravel turns every empty string in a request into null. Envelopes (ciphertext and header) are
 * opaque data that must reach the database exactly as the client sent it, so they are left alone.
 * (The other half, whitespace trimming, is switched off for the same keys in bootstrap/app.php.)
 */
class KeepEnvelopesUntouched extends ConvertEmptyStringsToNull
{
    protected function transform($key, $value)
    {
        if (Str::is('envelopes.*', (string) $key)) {
            return $value;
        }

        return parent::transform($key, $value);
    }
}
