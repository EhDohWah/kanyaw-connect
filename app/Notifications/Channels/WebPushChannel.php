<?php

namespace App\Notifications\Channels;

use App\Actions\Push\DeliverPush;
use App\Enums\PushOutcome;
use App\Jobs\RetryWebPush;
use App\Models\User;
use App\Notifications\Contracts\WebPushMessage;
use App\Services\WebPushService;

/**
 * Delivers a notification to every browser the user has subscribed. Runs inside the queue worker.
 */
class WebPushChannel
{
    public function __construct(private WebPushService $push, private DeliverPush $deliver) {}

    public function send(User $notifiable, WebPushMessage $notification): void
    {
        if (! $this->push->isConfigured()) {
            return;
        }

        $payload = $notification->toWebPush($notifiable);
        $options = $notification->webPushOptions();
        $retry = $options['retry'] ?? true;
        unset($options['retry']);

        foreach ($notifiable->pushSubscriptions()->get() as $subscription) {
            if ($this->deliver->handle($subscription, $payload, $options) === PushOutcome::Failed && $retry) {
                RetryWebPush::dispatch($subscription->getKey(), $payload, $options)->delay(30);
            }
        }
    }
}
