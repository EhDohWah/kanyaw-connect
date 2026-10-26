<?php

namespace App\Notifications;

use App\Models\Call;
use App\Models\NativePushToken;
use App\Notifications\Concerns\BuildsNativePush;
use App\Notifications\Concerns\ChoosesPushChannels;
use App\Notifications\Contracts\NativePushMessage;
use App\Notifications\Contracts\WebPushMessage;
use App\Services\NativePush\NativePushSender;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

/**
 * "Missed call from X", pushed to the callee like a new message (see NotifyCallParties::missed). On a
 * phone it is an ordinary notification (Android channel `missed-calls`, an APNs alert), never a VoIP push.
 */
class MissedCallNotification extends Notification implements NativePushMessage, ShouldQueue, WebPushMessage
{
    use BuildsNativePush, ChoosesPushChannels, Queueable;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(public array $payload) {}

    /** The call must be loaded with its caller. */
    public static function forCall(Call $call): self
    {
        return new self([
            'type' => 'call.missed',
            'call_id' => $call->getKey(),
            'chat_id' => $call->chat_id,
            'kind' => $call->kind->value,
            'title' => Str::limit($call->caller?->name ?: config('app.name'), 80),
            'body' => $call->isVoice() ? 'Missed voice call' : 'Missed video call',
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
        $data = array_diff_key($this->payload, ['title' => true, 'body' => true]);

        return $this->nativeAlert($registration, $sender, $this->payload['title'], $this->payload['body'], $data, 'missed-calls', config('push.ttl_seconds'), $this->payload['chat_id']);
    }

    public function retryNativePush(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function toWebPush(object $notifiable): array
    {
        return $this->payload;
    }

    /** The defaults from config/push.php. */
    public function webPushOptions(): array
    {
        return [];
    }
}
