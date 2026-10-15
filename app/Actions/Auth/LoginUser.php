<?php

namespace App\Actions\Auth;

use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class LoginUser
{
    /**
     * Verify credentials and issue a bearer token for the given device.
     *
     * @return array{user: User, token: string, expires_at: ?CarbonInterface}
     *
     * @throws ValidationException
     */
    public function handle(string $email, string $password, ?string $deviceName = null): array
    {
        $user = User::where('email', $email)->first();

        // Always run a hash check so response time does not reveal whether the email exists.
        $valid = Hash::check($password, $user?->password ?? Hash::make('dummy-password'));

        if (! $user || ! $valid) {
            throw ValidationException::withMessages([
                'email' => [__('auth.failed')],
            ]);
        }

        // The token carries its own expiry (sanctum.expiration, 30 days by default) so clients can show
        // "sign in again" before it stops working. Sanctum enforces the same limit from the creation time.
        $minutes = config('sanctum.expiration');
        $expiresAt = $minutes ? now()->addMinutes($minutes) : null;

        return [
            'user' => $user,
            'token' => $user->createToken($deviceName ?: 'api', ['*'], $expiresAt)->plainTextToken,
            'expires_at' => $expiresAt,
        ];
    }
}
