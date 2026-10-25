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
     * TTL and urgency for this push (see WebPushService::send). A plain property with a default, not a
     * promoted one, so a job queued before it existed still has it when the worker picks it up.
     *
     * @var array{ttl?: int, urgency?: string}
     */
    public array $options = [];

    /**
     * @param  array<string, mixed>  $payload
     * @param  array{ttl?: int, urgency?: string}  $options
     */
    public function __construct(public string $subscriptionId, public array $payload, array $options = [])
    {
        $this->options = $options;
    }

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

        if ($deliver->handle($subscription, $this->payload, $this->options) === PushOutcome::Failed) {
            throw new RuntimeException('The push service did not accept the notification.');
        }
    }
}
