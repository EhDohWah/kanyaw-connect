<?php

namespace App\Actions\Auth;

use App\Models\User;

class RegisterUser
{
    /**
     * Creates the account and emails a link to verify the address (queued). Nothing waits for it:
     * the app works the same before the address is verified.
     *
     * @param  array{name: string, email: string, password: string, phone?: string|null}  $data
     */
    public function handle(array $data): User
    {
        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'phone' => $data['phone'] ?? null,
            'password' => $data['password'], // hashed by the model cast
        ]);

        $user->sendEmailVerificationNotification();

        return $user;
    }
}
