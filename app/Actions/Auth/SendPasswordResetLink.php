<?php

namespace App\Actions\Auth;

use Illuminate\Support\Facades\Password;

class SendPasswordResetLink
{
    /**
     * Emails a reset link if an account uses this address. The caller learns nothing either way: an
     * unknown address, and a second request within a minute for the same address (the broker's
     * throttle), look exactly like a sent link.
     */
    public function handle(string $email): void
    {
        Password::broker()->sendResetLink(['email' => $email]);
    }
}
