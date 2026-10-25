<?php

namespace App\Actions\Auth;

use App\Models\User;
use App\Notifications\PasswordChangedNotification;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ResetPassword
{
    /**
     * Sets a new password with the token from the emailed link (the token works once, for 60 minutes).
     *
     * Every device is signed out, since the reset may be because someone else had the password. The
     * link reached the person's inbox, so the address is verified too.
     *
     * @throws ValidationException when the token is wrong, used or expired, or the address unknown
     *                             (one message for all, so nobody learns which addresses have accounts)
     */
    public function handle(string $email, #[\SensitiveParameter] string $token, #[\SensitiveParameter] string $password): void
    {
        $status = Password::broker()->reset(
            ['email' => $email, 'token' => $token, 'password' => $password],
            function (User $user, string $password): void {
                $user->forceFill([
                    'password' => $password, // hashed by the model cast
                    'remember_token' => Str::random(60),
                    'email_verified_at' => $user->email_verified_at ?? now(),
                ])->save();

                // Push subscriptions made with these tokens go with them (foreign key, cascade).
                $user->tokens()->delete();

                event(new PasswordReset($user));
                $user->notify(new PasswordChangedNotification('reset'));
            },
        );

        if ($status !== Password::PASSWORD_RESET) {
            throw ValidationException::withMessages([
                'token' => [__('This password reset link is not valid or has expired. Ask for a new one.')],
            ]);
        }
    }
}
