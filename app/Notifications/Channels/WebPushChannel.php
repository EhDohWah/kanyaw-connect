<?php

namespace App\Notifications\Channels;

use App\Actions\Push\DeliverPush;
use App\Enums\PushOutcome;
use App\Jobs\RetryWebPush;
use App\Models\User;
use App\Notifications\NewMessageNotification;
use App\Services\WebPushService;

/**
 * Delivers a notification to every browser the user has subscribed. Runs inside the queue worker.
 */
class WebPushChannel
{
    public function __construct(private WebPushService $push, private DeliverPush $deliver) {}

    public function send(User $notifiable, NewMessageNotification $notification): void
    {
        if (! $this->push->isConfigured()) {
            return;
        }

        $payload = $notification->toWebPush($notifiable);

        foreach ($notifiable->pushSubscriptions()->get() as $subscription) {
            if ($this->deliver->handle($subscription, $payload) === PushOutcome::Failed) {
                RetryWebPush::dispatch($subscription->getKey(), $payload)->delay(30);
            }
        }
    }
}
