<?php

namespace App\Policies;

use App\Models\NativePushToken;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class NativePushTokenPolicy
{
    /** Only the owner may remove a registration; anyone else gets 404 so ids cannot be probed. */
    public function manage(User $user, NativePushToken $token): Response
    {
        return $token->user_id === $user->getKey() ? Response::allow() : Response::denyAsNotFound();
    }
}
