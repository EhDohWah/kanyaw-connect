<?php

namespace App\Actions\Push;

use App\Enums\PushOutcome;
use App\Models\PushSubscription;
use App\Services\WebPushService;

class DeliverPush
{
    public function __construct(private WebPushService $push) {}

    /**
     * Send one payload to one browser. A subscription the push service reports as gone is deleted
     * on the spot, so it is not tried again for every later message.
     *
     * @param  array<string, mixed>  $payload
     */
    public function handle(PushSubscription $subscription, array $payload): PushOutcome
    {
        $outcome = $this->push->send($subscription, $payload);

        if ($outcome === PushOutcome::Expired) {
            $subscription->delete();
        }

        return $outcome;
    }
}
