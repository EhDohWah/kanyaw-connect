<?php

namespace App\Services;

use SodiumException;

/**
 * Checks that a signed prekey really is signed by the device's identity key.
 *
 * Only public values are involved: the Ed25519 identity public key, the signed prekey's public
 * key, and the signature. The signed message is the raw 32-byte signed prekey public key.
 */
class SignedPrekeyVerifier
{
    public function isValid(string $identityPublicKey, string $prekeyPublicKey, string $signature): bool
    {
        if (! config('e2ee.verify_signed_prekey')) {
            return true;
        }

        try {
            return sodium_crypto_sign_verify_detached(
                base64_decode($signature, true) ?: '',
                base64_decode($prekeyPublicKey, true) ?: '',
                base64_decode($identityPublicKey, true) ?: '',
            );
        } catch (SodiumException) {
            return false; // wrong lengths and the like
        }
    }
}
