<?php

namespace App\Policies;

use App\Enums\MessageType;
use App\Models\Message;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class MessagePolicy
{
    /** Senders can edit their own messages for a limited time. */
    public function update(User $user, Message $message): Response
    {
        // The chat is gone (its last member left): treat the message as gone too.
        if (! $message->chat) {
            return Response::denyAsNotFound();
        }

        if ($message->sender_id !== $user->getKey() || $message->type === MessageType::System) {
            return Response::deny('You can only edit your own messages.');
        }

        if (! $message->chat->membershipOf($user)) {
            return Response::deny();
        }

        if (! $message->isWithinEditWindow()) {
            return Response::deny('Messages can only be edited for '.config('chat.edit_window_hours').' hours after sending.');
        }

        return Response::allow();
    }

    /** The sender, or an admin/owner of the chat, can delete a message. */
    public function delete(User $user, Message $message): Response
    {
        if (! $message->chat) {
            return Response::denyAsNotFound();
        }

        $membership = $message->chat->membershipOf($user);

        if (! $membership) {
            return Response::deny();
        }

        if ($message->sender_id === $user->getKey() && $message->type !== MessageType::System) {
            return Response::allow();
        }

        return $membership->canManage()
            ? Response::allow()
            : Response::deny('Only the sender or a group admin can delete this message.');
    }
}
