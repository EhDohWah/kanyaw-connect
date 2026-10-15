<?php

namespace App\Actions\Rooms;

use App\Enums\RoomAdmission;
use App\Enums\RoomAuditAction;
use App\Models\Room;
use App\Models\User;
use App\Services\LiveKitService;
use App\Services\RoomAuditor;
use App\Services\RoomBroadcaster;
use Illuminate\Support\Facades\DB;

class RemoveRoomParticipant
{
    public function __construct(private LiveKitService $livekit, private RoomBroadcaster $broadcaster, private RoomAuditor $auditor) {}

    /**
     * Put someone out of the call and stop them coming back: they are marked denied (so no new token
     * is issued, and the webhook disconnects them again if they reconnect with a token they still
     * hold). The host can let them back in with admit.
     *
     * The database is updated first, so even if LiveKit cannot be reached right now the person
     * cannot get back in; the host sees the error and can try again.
     */
    public function handle(Room $room, User $target, User $actor): void
    {
        DB::transaction(function () use ($room, $target, $actor) {
            $room->participants()->where('user_id', $target->getKey())->update([
                'admission' => RoomAdmission::Denied,
                'token_issued_at' => null,
            ]);
            $this->auditor->record($room, RoomAuditAction::ParticipantRemoved, $actor, $target);
        });

        $this->broadcaster->denied($room, $target);

        $this->livekit->removeParticipant($room, $target);
    }
}
