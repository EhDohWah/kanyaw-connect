<?php

namespace App\Actions\Rooms;

use App\Enums\RoomAdmission;
use App\Enums\RoomAuditAction;
use App\Exceptions\RoomConflictException;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use App\Services\RoomAuditor;
use App\Services\RoomBroadcaster;
use Illuminate\Support\Facades\DB;

class ReviewJoinRequest
{
    public function __construct(private RoomBroadcaster $broadcaster, private RoomAuditor $auditor) {}

    /**
     * Let a waiting (or previously denied) person in. They hear about it on their user channel and
     * then call join again. Admitting someone who is already admitted changes nothing.
     */
    public function admit(Room $room, User $target, User $actor): RoomParticipant
    {
        $participant = $this->participant($room, $target);

        if ($participant->admission !== RoomAdmission::Admitted) {
            DB::transaction(function () use ($room, $participant, $target, $actor) {
                $participant->update(['admission' => RoomAdmission::Admitted]);
                $this->auditor->record($room, RoomAuditAction::ParticipantAdmitted, $actor, $target);
            });
            $this->broadcaster->admitted($room, $target);
        }

        return $participant;
    }

    /**
     * Turn a waiting person away. Only people who are waiting can be denied; to put someone out of a
     * call they are already in, use RemoveRoomParticipant.
     *
     * @throws RoomConflictException when the person is not waiting
     */
    public function deny(Room $room, User $target, User $actor): RoomParticipant
    {
        $participant = $this->participant($room, $target);

        if ($participant->admission === RoomAdmission::Denied) {
            return $participant;
        }

        if ($participant->admission !== RoomAdmission::Waiting) {
            throw new RoomConflictException('not_waiting', 'This person is not waiting to be let in.');
        }

        DB::transaction(function () use ($room, $participant, $target, $actor) {
            $participant->update(['admission' => RoomAdmission::Denied]);
            $this->auditor->record($room, RoomAuditAction::ParticipantDenied, $actor, $target);
        });
        $this->broadcaster->denied($room, $target);

        return $participant;
    }

    private function participant(Room $room, User $target): RoomParticipant
    {
        return $room->participants()->where('user_id', $target->getKey())->firstOrFail();
    }
}
