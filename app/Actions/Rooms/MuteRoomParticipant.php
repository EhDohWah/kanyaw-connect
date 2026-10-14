<?php

namespace App\Actions\Rooms;

use App\Exceptions\RoomConflictException;
use App\Models\Room;
use App\Models\User;
use App\Services\LiveKitService;

class MuteRoomParticipant
{
    public function __construct(private LiveKitService $livekit) {}

    /**
     * Mute a participant's microphone (or camera). LiveKit lets the server mute but not unmute:
     * the person unmutes themselves.
     *
     * @return int how many tracks were muted (0 if they were already muted)
     *
     * @throws RoomConflictException when the person is not connected
     */
    public function handle(Room $room, User $target, string $kind = 'audio'): int
    {
        $muted = $this->livekit->muteTrack($room, $target, $kind);

        if ($muted === null) {
            throw new RoomConflictException('participant_not_connected', 'That person is not in the call right now.');
        }

        return $muted;
    }
}
