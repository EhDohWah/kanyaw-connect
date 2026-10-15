<?php

namespace Database\Factories;

use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<PushSubscription>
 */
class PushSubscriptionFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $keys = self::browserKeys();

        return [
            'user_id' => User::factory(),
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/'.Str::random(140),
            'p256dh_key' => $keys['p256dh'],
            'auth_key' => $keys['auth'],
        ];
    }

    /**
     * What a browser holds for a push subscription: a P-256 key pair and a 16-byte auth secret. The
     * public half and the secret are what the browser sends to the server (base64url); the private
     * key stays in the browser. Tests keep it to prove a payload can be decrypted by the "browser".
     *
     * @return array{p256dh: string, auth: string, private_key: \OpenSSLAsymmetricKey}
     */
    public static function browserKeys(): array
    {
        $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
        $ec = openssl_pkey_get_details($key)['ec'];

        return [
            'p256dh' => self::base64Url("\x04".str_pad($ec['x'], 32, "\0", STR_PAD_LEFT).str_pad($ec['y'], 32, "\0", STR_PAD_LEFT)),
            'auth' => self::base64Url(random_bytes(16)),
            'private_key' => $key,
        ];
    }

    public static function base64Url(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
