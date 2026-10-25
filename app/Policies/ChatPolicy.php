<?php

namespace App\Policies;

use App\Enums\ChatRole;
use App\Models\Chat;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class ChatPolicy
{
    /** Members can see the chat, read and send its messages, mark it read and upload attachments. */
    public function view(User $user, Chat $chat): bool
    {
        return $chat->membershipOf($user) !== null;
    }

    /** Start a one-to-one call: a member of a direct chat whose other person still has an account. */
    public function call(User $user, Chat $chat): Response
    {
        if (! $chat->isDirect()) {
            return Response::deny('Calls are only possible in direct chats. Start a video room for a group.');
        }

        if (! $chat->membershipOf($user)) {
            return Response::deny();
        }

        return $chat->members()->where('users.id', '!=', $user->getKey())->exists()
            ? Response::allow()
            : Response::deny('The other person is no longer here.');
    }

    /** Rename / change the description of a group. */
    public function update(User $user, Chat $chat): Response
    {
        return $this->groupManager($user, $chat);
    }

    public function leave(User $user, Chat $chat): Response
    {
        if (! $chat->isGroup()) {
            return Response::deny('You cannot leave a direct chat.');
        }

        return $chat->membershipOf($user) ? Response::allow() : Response::deny();
    }

    public function addMembers(User $user, Chat $chat): Response
    {
        return $this->groupManager($user, $chat);
    }

    /**
     * Owners can remove anyone; admins can only remove plain members.
     * Nobody removes themselves here (they use "leave").
     */
    public function removeMember(User $user, Chat $chat, User $target): Response
    {
        $response = $this->groupManager($user, $chat);

        if ($response->denied()) {
            return $response;
        }

        $targetMembership = $chat->membershipOf($target);

        if (! $targetMembership) {
            return Response::denyAsNotFound('That user is not a member of this chat.');
        }

        if ($target->is($user)) {
            return Response::deny('Use the leave endpoint to leave a chat.');
        }

        if (! $chat->membershipOf($user)->isOwner() && $targetMembership->role !== ChatRole::Member) {
            return Response::deny('Only the owner can remove an admin or the owner.');
        }

        return Response::allow();
    }

    /** Only the owner changes roles, and never the owner's own role. */
    public function changeRole(User $user, Chat $chat, User $target): Response
    {
        if (! $chat->isGroup()) {
            return Response::deny('Roles only exist in group chats.');
        }

        if (! $chat->membershipOf($user)?->isOwner()) {
            return Response::deny('Only the owner can change roles.');
        }

        $targetMembership = $chat->membershipOf($target);

        if (! $targetMembership) {
            return Response::denyAsNotFound('That user is not a member of this chat.');
        }

        if ($targetMembership->role === ChatRole::Owner) {
            return Response::deny("The owner's role cannot be changed.");
        }

        return Response::allow();
    }

    private function groupManager(User $user, Chat $chat): Response
    {
        if (! $chat->isGroup()) {
            return Response::deny('This is only possible in group chats.');
        }

        return $chat->membershipOf($user)?->canManage()
            ? Response::allow()
            : Response::deny('Only group admins can do this.');
    }
}
