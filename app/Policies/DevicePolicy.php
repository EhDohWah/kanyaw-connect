<?php

namespace App\Policies;

use App\Models\Device;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class DevicePolicy
{
    /**
     * A device can only be managed by its owner, and only while it is active. Anyone else (and a
     * revoked device) is answered with 404, so device ids cannot be probed.
     */
    public function manage(User $user, Device $device): Response
    {
        return $device->user_id === $user->getKey() && ! $device->isRevoked()
            ? Response::allow()
            : Response::denyAsNotFound();
    }
}
