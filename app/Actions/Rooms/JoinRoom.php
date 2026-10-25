<?php

namespace App\Actions\Rooms;

use App\Enums\CallStatus;
use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Enums\RoomStatus;
use App\Exceptions\RoomConflictException;
use App\Models\Call;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use App\Services\LiveKitService;
use App\Services\RoomBroadcaster;
use Illuminate\Support\Facades\DB;

class JoinRoom
{
    public function __construct(private LiveKitService $livekit, private RoomBroadcaster $broadcaster) {}

    /**
     * Ask to join a room. The caller has already checked that the user may see the room and has
     * supplied the right password (see JoinRoomRequest).
     *
     * Everything that decides the outcome happens under a lock on the room row, so concurrent joins
     * take turns: the capacity check and the seat reservation cannot interleave.
     *
     * @return array{status: 'admitted'|'waiting', token: ?string}
     *
     * @throws RoomConflictException when the room has ended, is locked, is full, or the user was denied
     */
    public function handle(Room $room, User $user): array
    {
        $outcome = RoomAdmission::Waiting;
        $role = RoomRole::Participant;
        $notifyHosts = false;
        $notYetStarted = false;

        DB::transaction(function () use ($room, $user, &$outcome, &$role, &$notifyHosts, &$notYetStarted) {
            $locked = Room::whereKey($room->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->hasEnded()) {
                throw RoomConflictException::ended();
            }

            if ($call = $locked->call) {
                $this->checkCallIsOpenTo($call, $user);
            }

            /** @var RoomParticipant|null $participant */
            $participant = $locked->participants()->where('user_id', $user->getKey())->first();

            if ($participant?->admission === RoomAdmission::Denied) {
                throw RoomConflictException::denied();
            }

            if (! $participant) {
                if ($locked->is_locked) {
                    throw RoomConflictException::locked();
                }

                $waits = $locked->waiting_room_enabled;
                $participant = $locked->participants()->create([
                    'user_id' => $user->getKey(),
                    'role' => RoomRole::Participant,
                    'admission' => $waits ? RoomAdmission::Waiting : RoomAdmission::Admitted,
                ]);
                $notifyHosts = $waits;
            } elseif ($participant->admission === RoomAdmission::Waiting && ! $locked->waiting_room_enabled) {
                // The host switched the waiting room off while this person was in it.
                $participant->update(['admission' => RoomAdmission::Admitted]);
            }

            if ($participant->admission === RoomAdmission::Waiting) {
                return;
            }

            // Their own seat never counts against them, so reconnecting always works.
            if ($locked->seatsTakenExcept($user) >= $locked->max_participants) {
                throw RoomConflictException::full();
            }

            $participant->update(['token_issued_at' => now()]);

            $outcome = RoomAdmission::Admitted;
            $role = $participant->role;
            $notYetStarted = $locked->status === RoomStatus::Waiting;
        });

        if ($outcome === RoomAdmission::Waiting) {
            if ($notifyHosts) {
                $this->broadcaster->joinRequested($room, $user);
            }

            return ['status' => 'waiting', 'token' => null];
        }

        // LiveKit would create the room on first connect anyway, but only with its defaults;
        // creating it ourselves applies our participant limit. Idempotent.
        if ($notYetStarted) {
            $this->livekit->createRoom($room);
        }

        return ['status' => 'admitted', 'token' => $this->token($room, $user, $role)];
    }

    /**
     * The caller may connect while it rings (so their camera and microphone are ready the moment it
     * is answered); both may connect once it is answered. Before the callee answers, and after the
     * call is over, the room is closed to them.
     *
     * @throws RoomConflictException room_ended
     */
    private function checkCallIsOpenTo(Call $call, User $user): void
    {
        $open = match ($call->status) {
            CallStatus::Ringing => $user->getKey() === $call->caller_id && ! $call->ringExpired(),
            CallStatus::Ongoing => true,
            default => false,
        };

        if (! $open) {
            throw $call->status === CallStatus::Ringing
                ? new RoomConflictException('room_ended', 'Answer the call before joining it.')
                : RoomConflictException::ended();
        }
    }

    /**
     * In a call nobody gets host powers in LiveKit (neither can mute or remove the other), and a
     * voice call's token can publish the microphone only, so a camera can never be turned on in it.
     */
    private function token(Room $room, User $user, RoomRole $role): string
    {
        $call = $room->call;

        if (! $call) {
            return $this->livekit->generateToken($user, $room, $role);
        }

        return $this->livekit->generateToken($user, $room, RoomRole::Participant, $call->isVoice() ? ['microphone'] : null);
    }
}
