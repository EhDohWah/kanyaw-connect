<?php

namespace App\Actions\Auth;

use App\Models\User;

class RegisterUser
{
    /**
     * @param  array{name: string, email: string, password: string, phone?: string|null}  $data
     */
    public function handle(array $data): User
    {
        return User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'phone' => $data['phone'] ?? null,
            'password' => $data['password'], // hashed by the model cast
        ]);
    }
}
