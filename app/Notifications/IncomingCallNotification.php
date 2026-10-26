<?php

namespace App\Notifications;

use App\Enums\CallStatus;
use App\Models\Call;
use App\Models\NativePushToken;
use App\Notifications\Concerns\BuildsNativePush;
use App\Notifications\Concerns\ChoosesPushChannels;
use App\Notifications\Contracts\NativePushMessage;
use App\Notifications\Contracts\WebPushMessage;
use App\Services\NativePush\NativePushSender;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

/**
 * "X is calling", pushed to every browser and every phone of the callee so a phone with the app closed
 * can ring: a VoIP push (PushKit) on iOS, a high-priority FCM data message on Android.
 *
 * It lives only as long as the ringing: the push service drops it at ring_expires_at (TTL), it is
 * not retried, and it is not sent at all if the call stopped ringing while it waited in the queue.
 * The payload carries a signed decline URL because the service worker has no bearer token.
 */
class IncomingCallNotification extends Notification implements NativePushMessage, ShouldQueue, WebPushMessage
{
    use BuildsNativePush, ChoosesPushChannels, Queueable;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(public array $payload) {}

    /** The call must be loaded with its caller. */
    public static function forCall(Call $call): self
    {
        $caller = $call->caller;

        return new self([
            'type' => 'call.incoming',
            'call_id' => $call->getKey(),
            'chat_id' => $call->chat_id,
            'room_id' => $call->room_id,
            'kind' => $call->kind->value,
            'title' => Str::limit($caller?->name ?: config('app.name'), 80),
            'body' => $call->isVoice() ? 'Incoming voice call' : 'Incoming video call',
            'icon' => $caller?->avatar_thumb_url,
            'decline_url' => URL::temporarySignedRoute('calls.decline', $call->ring_expires_at, $call),
            'ring_expires_at' => $call->ring_expires_at->toJSON(), // same format as the API
        ]);
    }

    /**
     * @return list<class-string>
     */
    public function via(object $notifiable): array
    {
        return $this->pushChannels($notifiable);
    }

    public function toNativePush(NativePushToken $registration, NativePushSender $sender): array
    {
        return $this->nativeCallPush($registration, $sender, $this->payload, CarbonImmutable::parse($this->payload['ring_expires_at'])->getTimestamp());
    }

    /** A late "X is calling" is worse than none. */
    public function retryNativePush(): bool
    {
        return false;
    }

    /** Checked when the queue worker gets to it: a call that was answered, ended or ran out is not pushed. */
    public function shouldSend(object $notifiable, string $channel): bool
    {
        return $this->secondsLeft() > 0
            && Call::whereKey($this->payload['call_id'])->where('status', CallStatus::Ringing->value)->exists();
    }

    /**
     * @return array<string, mixed>
     */
    public function toWebPush(object $notifiable): array
    {
        return $this->payload;
    }

    /** Expire with the ringing, so a phone that comes online later never shows a call that is over. */
    public function webPushOptions(): array
    {
        return ['ttl' => max(1, $this->secondsLeft()), 'urgency' => 'high', 'retry' => false];
    }

    private function secondsLeft(): int
    {
        return (int) floor(CarbonImmutable::now()->diffInSeconds(CarbonImmutable::parse($this->payload['ring_expires_at']), false));
    }
}
