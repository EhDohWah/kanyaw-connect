<?php

namespace App\Jobs;

use App\Actions\Push\DeliverPush;
use App\Enums\PushOutcome;
use App\Models\PushSubscription;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use RuntimeException;

/**
 * Tries again to push to ONE browser after a temporary failure (timeout, 429, 5xx). Only the browser
 * that failed is retried, so the others do not get the notification twice.
 */
class RetryWebPush implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(public string $subscriptionId, public array $payload) {}

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300];
    }

    public function handle(DeliverPush $deliver): void
    {
        $subscription = PushSubscription::find($this->subscriptionId);

        if (! $subscription) {
            return; // signed out or unsubscribed in the meantime
        }

        if ($deliver->handle($subscription, $this->payload) === PushOutcome::Failed) {
            throw new RuntimeException('The push service did not accept the notification.');
        }
    }
}
