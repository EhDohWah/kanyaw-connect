<?php

namespace Tests\Support;

use App\Enums\PushOutcome;
use App\Models\PushSubscription;
use App\Models\User;
use App\Services\WebPushService;
use Throwable;

/**
 * Stands in for WebPushService in tests: records what would be sent and never touches the network.
 */
class FakeWebPushService extends WebPushService
{
    public bool $configured = true;

    /** @var list<array{subscription_id: string, user_id: string, endpoint: string, payload: array<string, mixed>, options: array<string, mixed>}> */
    public array $sent = [];

    /** @var array<string, PushOutcome> outcome per endpoint; anything not listed is Sent */
    public array $outcomes = [];

    public ?Throwable $throws = null;

    public function __construct()
    {
        parent::__construct(['subject' => 'mailto:test@example.org', 'public_key' => 'fake-public-key', 'private_key' => 'fake-private-key'], 3600, 'high', 5);
    }

    public function isConfigured(): bool
    {
        return $this->configured;
    }

    public function publicKey(): ?string
    {
        return $this->configured ? 'fake-public-key' : null;
    }

    public function send(PushSubscription $subscription, array $payload, array $options = []): PushOutcome
    {
        if ($this->throws) {
            throw $this->throws;
        }

        $this->sent[] = [
            'subscription_id' => $subscription->getKey(),
            'user_id' => $subscription->user_id,
            'endpoint' => $subscription->endpoint,
            'payload' => $payload,
            'options' => $options,
        ];

        return $this->outcomes[$subscription->endpoint] ?? PushOutcome::Sent;
    }

    /** Everything sent to this user's browsers. */
    public function sentTo(User $user): array
    {
        return array_values(array_filter($this->sent, fn (array $s) => $s['user_id'] === $user->getKey()));
    }

    /** @return list<string> ids of the users that were notified, without repeats */
    public function notifiedUserIds(): array
    {
        return array_values(array_unique(array_column($this->sent, 'user_id')));
    }
}
