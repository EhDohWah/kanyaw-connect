<?php

namespace App\Actions\Rooms;

use App\Enums\RoomAdmission;
use App\Models\Room;
use App\Models\User;
use App\Services\LiveKitService;
use App\Services\RoomBroadcaster;

class RemoveRoomParticipant
{
    public function __construct(private LiveKitService $livekit, private RoomBroadcaster $broadcaster) {}

    /**
     * Put someone out of the call and stop them coming back: they are marked denied (so no new token
     * is issued, and the webhook disconnects them again if they reconnect with a token they still
     * hold). The host can let them back in with admit.
     *
     * The database is updated first, so even if LiveKit cannot be reached right now the person
     * cannot get back in; the host sees the error and can try again.
     */
    public function handle(Room $room, User $target): void
    {
        $room->participants()->where('user_id', $target->getKey())->update([
            'admission' => RoomAdmission::Denied,
            'token_issued_at' => null,
        ]);

        $this->broadcaster->denied($room, $target);

        $this->livekit->removeParticipant($room, $target);
    }
}
