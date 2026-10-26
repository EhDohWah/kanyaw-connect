<?php

namespace App\Notifications;

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Models\Call;
use App\Models\NativePushToken;
use App\Notifications\Channels\NativePushChannel;
use App\Notifications\Concerns\BuildsNativePush;
use App\Notifications\Contracts\NativePushMessage;
use App\Services\NativePush\NativePushSender;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;

/**
 * "Stop ringing": sent to every phone of the callee when a ringing call ends by any route (answered
 * on one device, declined, cancelled by the caller, or not answered in time), over the same
 * transports as the incoming call, so a phone that is ringing with the app closed stops too.
 *
 * It lives a little longer than the ringing (at least 30 seconds), and is never retried.
 */
class CallRingingOverNotification extends Notification implements NativePushMessage, ShouldQueue
{
    use BuildsNativePush, Queueable;

    public const MIN_LIFETIME_SECONDS = 30;

    /**
     * @param  array{type: string, call_id: string, reason: string}  $payload
     */
    public function __construct(public array $payload, public string $expiresAt) {}

    /** Call this after the call left "ringing". */
    public static function forCall(Call $call): self
    {
        $expiresAt = CarbonImmutable::now()->addSeconds(self::MIN_LIFETIME_SECONDS)->max(CarbonImmutable::parse($call->ring_expires_at));

        return new self([
            'type' => 'call.ringing_over',
            'call_id' => $call->getKey(),
            'reason' => self::reasonFor($call),
        ], $expiresAt->toJSON());
    }

    /** answered | declined | cancelled | no_answer */
    public static function reasonFor(Call $call): string
    {
        return match (true) {
            $call->status === CallStatus::Ongoing, $call->status === CallStatus::Ended => 'answered',
            $call->status === CallStatus::Declined => 'declined',
            $call->end_reason === CallEndReason::Cancelled => 'cancelled',
            default => 'no_answer',
        };
    }

    /**
     * @return list<class-string>
     */
    public function via(object $notifiable): array
    {
        return [NativePushChannel::class];
    }

    public function toNativePush(NativePushToken $registration, NativePushSender $sender): array
    {
        return $this->nativeCallPush($registration, $sender, $this->payload, CarbonImmutable::parse($this->expiresAt)->getTimestamp());
    }

    public function retryNativePush(): bool
    {
        return false;
    }
}
