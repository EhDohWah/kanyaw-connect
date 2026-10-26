<?php

namespace Database\Factories;

use App\Enums\PushPlatform;
use App\Models\NativePushToken;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<NativePushToken>
 */
class NativePushTokenFactory extends Factory
{
    /**
     * An Android phone, registered under a real login token of its user.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'personal_access_token_id' => fn (array $attributes) => User::findOrFail($attributes['user_id'])
                ->createToken('Pixel 7 (Android)')->accessToken->getKey(),
            'platform' => PushPlatform::Android,
            'token' => Str::random(40).':'.Str::random(120),
            'voip_token' => null,
            'app_version' => '0.1.0',
            'last_seen_at' => now(),
        ];
    }

    /** An iPhone with an APNs device token and a PushKit (VoIP) token, both 64 hex digits. */
    public function ios(): static
    {
        return $this->state(fn () => [
            'platform' => PushPlatform::Ios,
            'token' => bin2hex(random_bytes(32)),
            'voip_token' => bin2hex(random_bytes(32)),
        ]);
    }
}
