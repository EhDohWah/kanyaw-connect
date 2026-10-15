<?php

namespace Database\Factories;

use App\Models\Device;
use App\Models\OneTimePrekey;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Creates devices with REAL libsodium key material (public keys only are stored), so signature checks
 * and key lengths are exactly what a client would produce. The private keys are thrown away.
 *
 * @extends Factory<Device>
 */
class DeviceFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $keys = self::keyMaterial(0)['payload'];

        return [
            'user_id' => User::factory(),
            'name' => fake()->randomElement(['Pixel 7', 'iPhone 15', 'Firefox on Linux', 'Chrome on Windows']),
            'identity_public_key' => $keys['identity_public_key'],
            'exchange_public_key' => $keys['exchange_public_key'],
            'signed_prekey_id' => $keys['signed_prekey']['id'],
            'signed_prekey_public' => $keys['signed_prekey']['public_key'],
            'signed_prekey_signature' => $keys['signed_prekey']['signature'],
            'signed_prekey_rotated_at' => now(),
        ];
    }

    public function revoked(): static
    {
        return $this->state(fn () => ['revoked_at' => now()]);
    }

    /** Also create this many unclaimed one-time prekeys. */
    public function withPrekeys(int $count = 20): static
    {
        return $this->afterCreating(function (Device $device) use ($count) {
            foreach (range(1, $count) as $keyId) {
                OneTimePrekey::create([
                    'device_id' => $device->id,
                    'key_id' => $keyId,
                    'public_key' => base64_encode(random_bytes(32)),
                    'created_at' => now(),
                ]);
            }
        });
    }

    /**
     * What a client would send to register a device: fresh keys, a signed prekey signed by the
     * identity key, and a batch of one-time prekeys. `identity_secret` stays with the test (it is the
     * client's private key and is never sent anywhere); everything else is the request body.
     *
     * @return array{payload: array{identity_public_key: string, exchange_public_key: string, signed_prekey: array{id: int, public_key: string, signature: string}, one_time_prekeys: list<array{id: int, public_key: string}>}, identity_secret: string}
     */
    public static function keyMaterial(int $oneTimePrekeys = 20, int $signedPrekeyId = 1): array
    {
        $identity = sodium_crypto_sign_keypair();
        $secret = sodium_crypto_sign_secretkey($identity);

        return [
            'payload' => [
                'identity_public_key' => base64_encode(sodium_crypto_sign_publickey($identity)),
                'exchange_public_key' => base64_encode(sodium_crypto_box_publickey(sodium_crypto_box_keypair())),
                'signed_prekey' => self::signedPrekeyFor($secret, $signedPrekeyId),
                'one_time_prekeys' => array_map(fn (int $id) => [
                    'id' => $id,
                    'public_key' => base64_encode(sodium_crypto_box_publickey(sodium_crypto_box_keypair())),
                ], $oneTimePrekeys > 0 ? range(1, $oneTimePrekeys) : []),
            ],
            'identity_secret' => $secret,
        ];
    }

    /**
     * A signed prekey: a fresh public key plus the identity key's signature over its raw 32 bytes.
     *
     * @return array{id: int, public_key: string, signature: string}
     */
    public static function signedPrekeyFor(string $identitySecretKey, int $id): array
    {
        $public = sodium_crypto_box_publickey(sodium_crypto_box_keypair());

        return [
            'id' => $id,
            'public_key' => base64_encode($public),
            'signature' => base64_encode(sodium_crypto_sign_detached($public, $identitySecretKey)),
        ];
    }
}
