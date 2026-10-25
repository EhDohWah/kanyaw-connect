<?php

namespace App\Services;

use App\Enums\PushOutcome;
use App\Models\PushSubscription;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Psr\Http\Client\ClientInterface;

/**
 * Sends one encrypted web-push message to one browser (RFC 8030 / 8291 / 8292) using the
 * minishlink/web-push library. Everything outside this class works with plain arrays and
 * PushOutcome, and tests replace it with a fake that never touches the network.
 */
class WebPushService
{
    /**
     * @param  array{subject: ?string, public_key: ?string, private_key: ?string}  $vapid
     * @param  ClientInterface|null  $client  PSR-18 HTTP client; tests pass one with a mock handler
     */
    public function __construct(private array $vapid, private int $ttl, private string $urgency, private int $timeout, private ?ClientInterface $client = null) {}

    /** Push is off until both VAPID keys are configured. */
    public function isConfigured(): bool
    {
        return filled($this->vapid['public_key']) && filled($this->vapid['private_key']);
    }

    /** The key the browser needs to subscribe (applicationServerKey). */
    public function publicKey(): ?string
    {
        return $this->isConfigured() ? $this->vapid['public_key'] : null;
    }

    /**
     * @param  array<string, mixed>  $payload  JSON-encoded, encrypted for the browser, and padded to a
     *                                         fixed size by the library so its length does not give the message away
     * @param  array{ttl?: int, urgency?: string}  $options  replace the configured TTL and urgency for this one push
     *
     * @throws \ErrorException when the VAPID keys are malformed (a configuration problem to fix, not retry)
     */
    public function send(PushSubscription $subscription, array $payload, array $options = []): PushOutcome
    {
        $webPush = new WebPush(
            ['VAPID' => ['subject' => $this->vapid['subject'], 'publicKey' => $this->vapid['public_key'], 'privateKey' => $this->vapid['private_key']]],
            ['TTL' => $options['ttl'] ?? $this->ttl, 'urgency' => $options['urgency'] ?? $this->urgency],
            $this->client ?? $this->defaultClient(),
        );

        try {
            $report = $webPush->sendOneNotification(
                new Subscription($subscription->endpoint, $subscription->p256dh_key, $subscription->auth_key, 'aes128gcm'),
                json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            );
        } catch (\Throwable $e) {
            // The subscription's own keys can be unusable (the library fails while encrypting). That
            // says nothing about the other subscriptions, so it is a failure of this one only.
            if ($e instanceof \ErrorException && str_contains($e->getMessage(), 'VAPID')) {
                throw $e;
            }

            Log::warning('Web push could not be prepared.', ['subscription' => $subscription->getKey(), 'error' => $e->getMessage()]);

            return PushOutcome::Failed;
        }

        // The library counts anything below 400 as success; only 2xx means the push service took it
        // (a redirect, which is never followed, did not).
        $status = $report->getResponse()?->getStatusCode();

        if ($report->isSuccess() && $status !== null && $status >= 200 && $status < 300) {
            return PushOutcome::Sent;
        }

        if ($report->isSubscriptionExpired()) {
            return PushOutcome::Expired;
        }

        Log::warning('Web push was not accepted.', [
            'subscription' => $subscription->getKey(),
            'status' => $report->getResponse()?->getStatusCode(),
            'reason' => $report->getReason(),
        ]);

        return PushOutcome::Failed;
    }

    /**
     * No redirects (a push service answering with one is not to be followed to another address) and
     * HTTP error statuses returned instead of thrown, because the library reads the status itself.
     */
    private function defaultClient(): ClientInterface
    {
        return new Client([
            'timeout' => $this->timeout,
            'connect_timeout' => min(5, $this->timeout),
            'allow_redirects' => false,
            'http_errors' => false,
        ]);
    }
}
