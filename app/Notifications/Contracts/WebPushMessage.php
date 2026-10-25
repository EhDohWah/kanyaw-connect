<?php

namespace App\Notifications\Contracts;

/** A notification that WebPushChannel can deliver to a user's browsers. */
interface WebPushMessage
{
    /**
     * The JSON the service worker receives.
     *
     * @return array<string, mixed>
     */
    public function toWebPush(object $notifiable): array;

    /**
     * How to send it. `ttl` (seconds the push service keeps it for an offline device) and `urgency`
     * replace the defaults from config/push.php; `retry: false` gives up after one failed attempt,
     * for pushes that are useless once late.
     *
     * @return array{ttl?: int, urgency?: string, retry?: bool}
     */
    public function webPushOptions(): array;
}
