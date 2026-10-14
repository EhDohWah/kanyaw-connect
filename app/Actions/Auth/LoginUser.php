<?php

namespace App\Actions\Auth;

use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class LoginUser
{
    /**
     * Verify credentials and issue a bearer token for the given device.
     *
     * @return array{user: User, token: string}
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

        return [
            'user' => $user,
            'token' => $user->createToken($deviceName ?: 'api')->plainTextToken,
        ];
    }
}
