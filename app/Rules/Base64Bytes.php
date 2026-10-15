<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * A standard (RFC 4648, padded) base64 string that decodes to exactly N bytes. Used for PUBLIC keys
 * and signatures only, to reject malformed uploads early. It is never applied to ciphertext.
 */
class Base64Bytes implements ValidationRule
{
    public function __construct(private int $length) {}

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $decoded = is_string($value) ? base64_decode($value, true) : false;

        // The re-encode check rejects non-canonical forms (missing padding, stray characters).
        if ($decoded === false || strlen($decoded) !== $this->length || base64_encode($decoded) !== $value) {
            $fail("The :attribute must be standard base64 of exactly {$this->length} bytes.");
        }
    }
}
