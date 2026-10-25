<?php

namespace App\Actions\Rooms;

use App\Actions\Calls\FinishCall;
use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Enums\RoomStatus;
use App\Jobs\EndCallAfterGrace;
use App\Jobs\TransferRoomHostJob;
use App\Models\Call;
use App\Models\Room;
use App\Models\User;
use App\Services\LiveKitService;
use App\Services\RoomBroadcaster;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Livekit\WebhookEvent;

/**
 * Applies LiveKit webhooks. LiveKit is the source of truth for who is connected, so joined_at and
 * left_at are only ever written here. LiveKit may deliver an event twice or out of order, so every
 * handler is safe to repeat.
 */
class HandleLiveKitWebhook
{
    public function __construct(
        private LiveKitService $livekit,
        private RoomBroadcaster $broadcaster,
        private TransferRoomHost $transferHost,
        private EndRoom $endRoom,
        private FinishCall $finishCall,
    ) {}

    public function handle(WebhookEvent $event): void
    {
        $roomName = $event->getRoom()?->getName();
        $room = $roomName ? Room::where('livekit_room_name', $roomName)->first() : null;

        if (! $room) {
            return; // not one of ours
        }

        // Use LiveKit's own clock: our processing may lag behind a delayed or retried delivery.
        $at = $event->getCreatedAt() > 0 ? CarbonImmutable::createFromTimestamp($event->getCreatedAt()) : CarbonImmutable::now();
        $identity = (string) $event->getParticipant()?->getIdentity();

        match ($event->getEvent()) {
            'participant_joined' => $this->participantJoined($room, $identity, $at),
            'participant_left' => $this->participantLeft($room, $identity, $at),
            'room_finished' => $this->roomFinished($room),
            default => null,
        };
    }

    private function participantJoined(Room $room, string $identity, CarbonImmutable $at): void
    {
        if (! Str::isUuid($identity)) {
            return; // e.g. a recorder or agent, not a user
        }

        $joined = null;
        $reject = false;

        DB::transaction(function () use ($room, $identity, $at, &$joined, &$reject) {
            $locked = Room::whereKey($room->getKey())->lockForUpdate()->firstOrFail();
            $participant = $locked->participants()->where('user_id', $identity)->first();

            // Someone connected with a token we would not issue now (removed, denied, never asked,
            // or the room is over): put them out again.
            if (! $participant || $participant->admission !== RoomAdmission::Admitted || $locked->hasEnded()) {
                $reject = true;

                return;
            }

            // Duplicate delivery, or a "joined" that is older than a "left" we already recorded.
            if ($participant->isPresent() || ($participant->left_at && $participant->left_at->greaterThan($at))) {
                return;
            }

            $participant->update(['joined_at' => $at, 'left_at' => null, 'token_issued_at' => null]);

            if ($locked->status === RoomStatus::Waiting) {
                $locked->update(['status' => RoomStatus::Active, 'started_at' => $at]);
            }

            $joined = $participant;
        });

        if ($reject) {
            $this->livekit->removeParticipant($room, $identity);

            return;
        }

        if ($joined && ($user = User::find($identity))) {
            $this->broadcaster->participantJoined($room, $user, $joined->role);
        }
    }

    private function participantLeft(Room $room, string $identity, CarbonImmutable $at): void
    {
        if (! Str::isUuid($identity)) {
            return;
        }

        $left = null;

        DB::transaction(function () use ($room, $identity, $at, &$left) {
            Room::whereKey($room->getKey())->lockForUpdate()->firstOrFail();
            $participant = $room->participants()->where('user_id', $identity)->first();

            // Ignore duplicates, and "left" events that are older than the person's latest join
            // (they reconnected and the old event arrived late).
            if (! $participant || ! $participant->isPresent() || $participant->joined_at->greaterThan($at)) {
                return;
            }

            $participant->update(['left_at' => $at, 'token_issued_at' => null]);
            $left = $participant;
        });

        if (! $left) {
            return;
        }

        if ($user = User::find($identity)) {
            $this->broadcaster->participantLeft($room, $user, $left->role);
        }

        if ($call = $room->call) {
            // A call has no host to hand on; what matters is whether the person comes back.
            if ($call->status === CallStatus::Ongoing) {
                $this->scheduleCallEnd($call, $identity);
            }

            return;
        }

        if ($left->role === RoomRole::Host) {
            $this->scheduleHostTransfer($room, $identity);
        }
    }

    /**
     * Someone dropped out of an answered call. Give them calls.reconnect_grace_seconds to come back
     * (a phone switching from wifi to mobile data, a tunnel) before the call ends as connection_lost.
     */
    private function scheduleCallEnd(Call $call, string $userId): void
    {
        $job = new EndCallAfterGrace($call->getKey(), $userId);
        $grace = config('calls.reconnect_grace_seconds');

        $grace > 0 ? dispatch($job)->delay(now()->addSeconds($grace)) : dispatch_sync($job);
    }

    private function scheduleHostTransfer(Room $room, string $previousHostId): void
    {
        $grace = config('rooms.host_transfer_grace_seconds');

        if ($grace > 0) {
            TransferRoomHostJob::dispatch($room->getKey(), $previousHostId)->delay(now()->addSeconds($grace));

            return;
        }

        $this->transferHost->handle($room, $previousHostId);
    }

    /**
     * LiveKit closed the room (everyone left and the empty timeout passed, or we deleted it).
     * A room nobody ever joined is left alone so a scheduled meeting is not ended before it starts.
     */
    private function roomFinished(Room $room): void
    {
        // An answered call cannot go on without its room. This closes our room too (FinishCall).
        if ($room->call?->status === CallStatus::Ongoing) {
            $this->finishCall->handle($room->call, CallStatus::Ended, CallEndReason::ConnectionLost, [CallStatus::Ongoing]);

            return;
        }

        if ($room->status !== RoomStatus::Active) {
            return;
        }

        if ($this->endRoom->markEnded($room)) {
            $this->broadcaster->ended($room);
        }
    }
}
