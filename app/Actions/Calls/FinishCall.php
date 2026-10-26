<?php

namespace App\Actions\Calls;

use App\Actions\Push\NotifyCallParties;
use App\Actions\Rooms\EndRoom;
use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Enums\MessageType;
use App\Exceptions\LiveKitException;
use App\Models\Call;
use App\Models\Message;
use App\Services\CallBroadcaster;
use App\Services\ChatBroadcaster;
use App\Services\LiveKitService;
use App\Services\RoomBroadcaster;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Moves a call to its final status (declined, missed or ended), exactly once, and does what follows:
 * closes its room, tells both people (call.declined / call.missed / call.ended), posts the summary
 * message in the chat, tells the callee's phones to stop ringing if it was still ringing, and, for a
 * missed call, pushes "Missed call" to the callee.
 *
 * Every way a call can stop goes through here: the two people, the ringing timeout, the LiveKit
 * webhook, the reconnect grace and the stale cleanup. They can race; the lock on the call row
 * decides which one wins, and the others see that the call already moved on.
 */
class FinishCall
{
    public function __construct(
        private EndRoom $endRoom,
        private LiveKitService $livekit,
        private RoomBroadcaster $roomBroadcaster,
        private CallBroadcaster $broadcaster,
        private ChatBroadcaster $chatBroadcaster,
        private NotifyCallParties $notifier,
    ) {}

    /**
     * Finish the call if it is still in one of the $from statuses. A call that is still "ringing"
     * after its ringing time is up was missed, whatever was asked: it becomes missed (no_answer).
     *
     * Afterwards $call holds the call as it is now, whether or not this call changed it.
     *
     * @param  list<CallStatus>  $from
     * @return bool true if this call finished it
     */
    public function handle(Call $call, CallStatus $status, ?CallEndReason $reason, array $from): bool
    {
        $summary = null;
        $wasRinging = false;

        $finished = DB::transaction(function () use ($call, $status, $reason, $from, &$summary, &$wasRinging) {
            $locked = Call::whereKey($call->getKey())->lockForUpdate()->firstOrFail();

            if (! in_array($locked->status, $from, true)) {
                $call->setRawAttributes($locked->getAttributes(), true);

                return false;
            }

            $wasRinging = $locked->status === CallStatus::Ringing;

            if ($locked->status === CallStatus::Ringing && $locked->ringExpired()) {
                [$status, $reason] = [CallStatus::Missed, CallEndReason::NoAnswer];
            }

            $locked->update(['status' => $status, 'end_reason' => $reason, 'ended_at' => now()]);
            $summary = $this->postSummary($locked);

            $call->setRawAttributes($locked->getAttributes(), true);

            return true;
        });

        if (! $finished) {
            return false;
        }

        $this->closeRoom($call);
        $this->broadcaster->finished($call);
        $this->chatBroadcaster->messageSent($summary);

        if ($wasRinging) {
            $this->notifier->ringingOver($call);
        }

        if ($call->status === CallStatus::Missed) {
            $this->notifier->missed($call);
        }

        return true;
    }

    /**
     * Close the LiveKit room and mark ours ended. Unlike a meeting, the call is over whatever LiveKit
     * says: if it cannot be reached the room is still marked ended (nobody can join it again), and
     * LiveKit closes its side by itself once the two have disconnected (the empty timeout).
     */
    private function closeRoom(Call $call): void
    {
        $room = $call->room;

        try {
            $this->livekit->deleteRoom($room);
        } catch (LiveKitException $e) {
            Log::warning('Could not close the LiveKit room of a finished call; LiveKit will close it when it is empty.', ['call' => $call->getKey()]);
        }

        if ($this->endRoom->markEnded($room)) {
            $this->roomBroadcaster->ended($room);
        }
    }

    /**
     * The "Missed voice call" / "Video call · 3:12" line in the chat. Clients should render it from
     * metadata; the content is an English fallback. It has no sender, like every system message.
     */
    private function postSummary(Call $call): Message
    {
        $message = Message::create([
            'chat_id' => $call->chat_id,
            'sender_id' => null,
            'type' => MessageType::System,
            'content' => self::summaryText($call),
            'metadata' => [
                'event' => 'call',
                'call_id' => $call->getKey(),
                'kind' => $call->kind->value,
                'status' => $call->status->value,
                'end_reason' => $call->end_reason?->value,
                'caller_id' => $call->caller_id,
                'duration_seconds' => $call->durationSeconds(),
            ],
        ]);

        $call->chat->bumpLastMessageAt($message->created_at);

        return $message;
    }

    public static function summaryText(Call $call): string
    {
        $kind = $call->isVoice() ? 'voice call' : 'video call';

        return match ($call->status) {
            CallStatus::Missed => "Missed {$kind}",
            CallStatus::Declined => ucfirst($kind).' declined',
            default => ucfirst($kind).' · '.self::clock($call->durationSeconds() ?? 0),
        };
    }

    /** 3:12, or 1:02:03 past an hour. */
    private static function clock(int $seconds): string
    {
        $hours = intdiv($seconds, 3600);
        $minutes = intdiv($seconds % 3600, 60);
        $rest = $seconds % 60;

        return $hours > 0 ? sprintf('%d:%02d:%02d', $hours, $minutes, $rest) : sprintf('%d:%02d', $minutes, $rest);
    }
}
