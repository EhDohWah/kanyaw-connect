<?php

namespace Tests\Support;

use OpenSSLAsymmetricKey;

/**
 * Decrypts a Web Push body the way a browser does (RFC 8291, "aes128gcm"), written from the RFC and
 * not from the library under test, so a passing test shows the payload really is readable by the
 * subscriber and by nobody else.
 */
final class WebPushDecryptor
{
    /**
     * @param  array{p256dh: string, auth: string, private_key: OpenSSLAsymmetricKey}  $browserKeys  as made by PushSubscriptionFactory::browserKeys()
     */
    public static function decrypt(string $body, array $browserKeys): string
    {
        // Header (RFC 8188): salt(16) | record size(4) | key id length(1) | key id | encrypted records.
        $salt = substr($body, 0, 16);
        $keyIdLength = ord($body[20]);
        $senderPublic = substr($body, 21, $keyIdLength);   // the server's one-time public key
        $encrypted = substr($body, 21 + $keyIdLength);

        $receiverPublic = self::base64Url($browserKeys['p256dh']);
        $authSecret = self::base64Url($browserKeys['auth']);

        $shared = openssl_pkey_derive(openssl_pkey_get_public(self::pem($senderPublic)), $browserKeys['private_key'], 32);

        $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0".$receiverPublic.$senderPublic, $authSecret);
        $contentKey = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
        $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);

        $plain = openssl_decrypt(substr($encrypted, 0, -16), 'aes-128-gcm', $contentKey, OPENSSL_RAW_DATA, $nonce, substr($encrypted, -16));

        if ($plain === false) {
            throw new \RuntimeException('The payload cannot be decrypted with these keys.');
        }

        // The message is followed by a 0x02 delimiter and zero padding.
        $plain = rtrim($plain, "\0");

        if (! str_ends_with($plain, "\x02")) {
            throw new \RuntimeException('Missing padding delimiter.');
        }

        return substr($plain, 0, -1);
    }

    private static function base64Url(string $value): string
    {
        return base64_decode(strtr($value, '-_', '+/').str_repeat('=', (4 - strlen($value) % 4) % 4), true);
    }

    /** An uncompressed P-256 point as a PEM public key (fixed SubjectPublicKeyInfo header + point). */
    private static function pem(string $point): string
    {
        $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200').$point;

        return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END PUBLIC KEY-----\n";
    }
}
