<?php

namespace App\Policies;

use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class PushSubscriptionPolicy
{
    /** Only the owner may remove a subscription; anyone else gets 404 so ids cannot be probed. */
    public function manage(User $user, PushSubscription $subscription): Response
    {
        return $subscription->user_id === $user->getKey() ? Response::allow() : Response::denyAsNotFound();
    }
}
