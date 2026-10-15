<?php

namespace App\Policies;

use App\Models\ChatMember;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class UserPolicy
{
    /**
     * You can fetch someone's key bundles if it is you (to sync your own other devices) or you share
     * a chat with them. Otherwise 404: strangers cannot enumerate devices or drain prekeys.
     */
    public function fetchKeyBundles(User $actor, User $target): Response
    {
        if ($actor->is($target)) {
            return Response::allow();
        }

        $shareAChat = ChatMember::where('user_id', $actor->getKey())
            ->whereIn('chat_id', ChatMember::select('chat_id')->where('user_id', $target->getKey()))
            ->exists();

        return $shareAChat ? Response::allow() : Response::denyAsNotFound();
    }
}
