<?php

namespace App\Notifications\Concerns;

use App\Models\User;
use App\Notifications\Channels\NativePushChannel;
use App\Notifications\Channels\WebPushChannel;
use App\Services\WebPushService;
use Illuminate\Support\Str;

/**
 * Only the channels that can reach this person, because Laravel queues one job per channel: a
 * person with only a phone should not cost a web-push job that finds nothing to do.
 *
 * Callers sending to many people load `withExists(['pushSubscriptions', 'nativePushTokens'])` so this
 * asks the database nothing per person; without it, it asks.
 */
trait ChoosesPushChannels
{
    /**
     * @return list<class-string>
     */
    protected function pushChannels(User $notifiable): array
    {
        $channels = [];

        if (app(WebPushService::class)->isConfigured() && $this->has($notifiable, 'pushSubscriptions')) {
            $channels[] = WebPushChannel::class;
        }

        if ($this->has($notifiable, 'nativePushTokens')) {
            $channels[] = NativePushChannel::class;
        }

        return $channels;
    }

    private function has(User $user, string $relation): bool
    {
        $key = Str::snake($relation).'_exists';

        return array_key_exists($key, $user->getAttributes()) ? (bool) $user->getAttributes()[$key] : $user->{$relation}()->exists();
    }
}
