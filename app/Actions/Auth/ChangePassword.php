<?php

namespace App\Actions\Auth;

use App\Models\User;
use App\Notifications\PasswordChangedNotification;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class ChangePassword
{
    /**
     * Changes the password of a signed-in person who knows the current one. This device stays signed
     * in; every other device is signed out (their push subscriptions go with their tokens).
     *
     * @throws ValidationException when the current password is wrong
     */
    public function handle(User $user, #[\SensitiveParameter] string $current, #[\SensitiveParameter] string $new, mixed $currentToken): void
    {
        if (! Hash::check($current, $user->password)) {
            throw ValidationException::withMessages([
                'current_password' => [__('The current password is incorrect.')],
            ]);
        }

        $user->forceFill(['password' => $new])->save(); // hashed by the model cast

        $keep = $currentToken instanceof PersonalAccessToken ? $currentToken->getKey() : null;
        $user->tokens()->when($keep !== null, fn ($query) => $query->whereKeyNot($keep))->delete();

        $user->notify(new PasswordChangedNotification('changed'));
    }
}
