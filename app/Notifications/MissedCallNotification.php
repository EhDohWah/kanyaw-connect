<?php

namespace App\Notifications;

use App\Models\Call;
use App\Notifications\Channels\WebPushChannel;
use App\Notifications\Contracts\WebPushMessage;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

/** "Missed call from X", pushed to the callee like a new message (see NotifyCallParties::missed). */
class MissedCallNotification extends Notification implements ShouldQueue, WebPushMessage
{
    use Queueable;

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
        return [WebPushChannel::class];
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
