<?php

namespace App\Notifications\Channels;

use App\Actions\Push\DeliverNativePush;
use App\Enums\PushOutcome;
use App\Jobs\RetryNativePush;
use App\Models\User;
use App\Notifications\Contracts\NativePushMessage;
use App\Services\NativePush\NativePushSender;

/**
 * Delivers a notification to every phone the user is signed in to (FCM on Android, APNs on iOS).
 * Runs inside the queue worker. A platform without credentials is skipped.
 */
class NativePushChannel
{
    public function __construct(private NativePushSender $sender, private DeliverNativePush $deliver) {}

    public function send(User $notifiable, NativePushMessage $notification): void
    {
        foreach ($notifiable->nativePushTokens()->get() as $registration) {
            if (! $this->sender->isConfigured($registration->platform)) {
                continue;
            }

            foreach ($notification->toNativePush($registration, $this->sender) as $message) {
                if ($this->deliver->handle($registration, $message) === PushOutcome::Failed && $notification->retryNativePush()) {
                    RetryNativePush::dispatch($registration->getKey(), $message)->delay(30);
                }
            }
        }
    }
}
