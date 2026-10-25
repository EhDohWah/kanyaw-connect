<?php

namespace App\Actions\Auth;

use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Auth\Events\Verified;

class VerifyEmail
{
    /**
     * Marks the address verified from the link in the email (the route has already checked the
     * signature and the expiry). Works signed out, on any device: the signed link is the proof.
     *
     * @return bool false when it was verified already (nothing changes)
     *
     * @throws AuthorizationException when the link was made for another address
     */
    public function handle(User $user, string $hash): bool
    {
        if (! hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            throw new AuthorizationException(__('This verification link is not valid.'));
        }

        if ($user->hasVerifiedEmail()) {
            return false;
        }

        $user->markEmailAsVerified();
        event(new Verified($user));

        return true;
    }
}
