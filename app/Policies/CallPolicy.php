<?php

namespace App\Policies;

use App\Models\Call;
use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * Only the two people in a call know it exists: everyone else gets the same 404 as for an id that
 * does not exist.
 */
class CallPolicy
{
    public function view(User $user, Call $call): Response
    {
        return $call->involves($user) ? Response::allow() : self::notFound();
    }

    /** Accept or decline: the person being called. */
    public function answer(User $user, Call $call): Response
    {
        return $this->onlyFor($user, $call, $call->callee_id, 'Only the person being called can answer or decline.');
    }

    /** Cancel before it is answered: the person calling. */
    public function cancel(User $user, Call $call): Response
    {
        return $this->onlyFor($user, $call, $call->caller_id, 'Only the person calling can cancel. To say no, decline.');
    }

    /** Hang up an answered call: either of the two. */
    public function end(User $user, Call $call): Response
    {
        return $this->view($user, $call);
    }

    private function onlyFor(User $user, Call $call, string $userId, string $message): Response
    {
        if (! $call->involves($user)) {
            return self::notFound();
        }

        return $user->getKey() === $userId ? Response::allow() : Response::deny($message);
    }

    private static function notFound(): Response
    {
        return Response::denyAsNotFound('Not found.');
    }
}
