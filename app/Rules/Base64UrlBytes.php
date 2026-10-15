<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * An unpadded base64url string (RFC 4648 section 5, what browsers produce for push subscriptions)
 * that decodes to exactly N bytes, optionally starting with a given byte. Public keys and secrets only.
 */
class Base64UrlBytes implements ValidationRule
{
    public function __construct(private int $length, private ?string $firstByte = null) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $decoded = null;

        if (is_string($value) && preg_match('/^[A-Za-z0-9_-]+$/', $value) && strlen($value) % 4 !== 1) {
            $padded = strtr($value, '-_', '+/').str_repeat('=', (4 - strlen($value) % 4) % 4);
            $decoded = base64_decode($padded, true);
        }

        // The re-encode check rejects non-canonical encodings (stray trailing bits).
        $valid = $decoded !== null && $decoded !== false
            && strlen($decoded) === $this->length
            && rtrim(strtr(base64_encode($decoded), '+/', '-_'), '=') === $value
            && ($this->firstByte === null || str_starts_with($decoded, $this->firstByte));

        if (! $valid) {
            $fail("The :attribute must be unpadded base64url of exactly {$this->length} bytes.");
        }
    }
}
