<?php

namespace App\Actions\Rooms;

use App\Enums\RoomRole;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use App\Services\RoomBroadcaster;

class PromoteCoHost
{
    public function __construct(private RoomBroadcaster $broadcaster) {}

    /**
     * Make an admitted participant a co-host. Their LiveKit token was signed with their old role, so
     * the admin rights on the LiveKit side apply from their next join; our own API treats them as a
     * co-host immediately.
     */
    public function handle(Room $room, User $target): RoomParticipant
    {
        $participant = $room->participants()->where('user_id', $target->getKey())->firstOrFail();

        if ($participant->role === RoomRole::Participant) {
            $participant->update(['role' => RoomRole::CoHost]);
            $this->broadcaster->roleChanged($room, $target->getKey(), RoomRole::CoHost);
        }

        return $participant;
    }
}
