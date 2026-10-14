<?php

namespace App\Actions\Users;

use App\Models\User;

class UpdateProfile
{
    /**
     * Apply a partial profile update.
     *
     * `settings` is merged key-by-key (top level) into the stored settings,
     * so a client can change one preference without resending all of them.
     *
     * @param  array<string, mixed>  $data  validated input
     */
    public function handle(User $user, array $data): User
    {
        if (array_key_exists('settings', $data)) {
            $data['settings'] = array_merge($user->settings ?? [], $data['settings'] ?? []);
        }

        $user->fill($data)->save();

        return $user;
    }
}
