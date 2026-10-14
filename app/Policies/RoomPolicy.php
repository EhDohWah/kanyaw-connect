<?php

namespace App\Policies;

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Models\Room;
use App\Models\User;
use Illuminate\Auth\Access\Response;

class RoomPolicy
{
    /**
     * Who may look at a room (and ask to join it): its host, anyone who has asked to join, members of
     * the chat it is linked to, and — for rooms not linked to a chat — anyone with the link.
     */
    public function view(User $user, Room $room): bool
    {
        if ($room->host_id === $user->getKey() || $room->participantFor($user)) {
            return true;
        }

        if ($room->chat_id === null) {
            return true;
        }

        return $room->chat?->membershipOf($user) !== null;
    }

    public function join(User $user, Room $room): Response
    {
        if (! $this->view($user, $room)) {
            return Response::deny('You are not invited to this room.');
        }

        return $room->participantFor($user)?->admission === RoomAdmission::Denied
            ? Response::deny('The host has not allowed you to join this room.')
            : Response::allow();
    }

    /** Admit or deny people waiting to join: the host and co-hosts. */
    public function manage(User $user, Room $room): Response
    {
        return $room->isManagedBy($user) ? Response::allow() : Response::deny('Only the host or a co-host can do this.');
    }

    /** Lock, unlock, end, and appoint co-hosts: the host only. */
    public function host(User $user, Room $room): Response
    {
        return $room->host_id === $user->getKey() ? Response::allow() : Response::deny('Only the host can do this.');
    }

    /**
     * Remove or mute somebody. The host can do it to anyone else; a co-host only to plain
     * participants (not to the host or another co-host). Nobody does it to themselves.
     */
    public function moderate(User $user, Room $room, User $target): Response
    {
        $manage = $this->manage($user, $room);

        if ($manage->denied()) {
            return $manage;
        }

        $targetRow = $room->participantFor($target);

        if (! $targetRow) {
            return Response::denyAsNotFound('That person is not part of this room.');
        }

        if ($target->is($user)) {
            return Response::deny('You cannot do this to yourself.');
        }

        if ($room->host_id !== $user->getKey() && $targetRow->role !== RoomRole::Participant) {
            return Response::deny('Only the host can do this to the host or a co-host.');
        }

        return Response::allow();
    }

    /** Appoint a co-host: host only, and the person must already be in the room. */
    public function appointCoHost(User $user, Room $room, User $target): Response
    {
        $host = $this->host($user, $room);

        if ($host->denied()) {
            return $host;
        }

        $targetRow = $room->participantFor($target);

        if ($targetRow?->admission !== RoomAdmission::Admitted) {
            return Response::denyAsNotFound('That person is not in this room.');
        }

        return Response::allow();
    }
}
