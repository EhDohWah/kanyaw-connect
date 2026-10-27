<?php

namespace App\Services\NativePush;

/**
 * One FCM HTTP v1 message to one Android phone. Either a notification (shown by the system on a
 * notification channel) or a data message (handed to the app, used for calls).
 */
final readonly class FcmMessage
{
    /** Data keys FCM keeps for itself: a message using one is refused whole (400 INVALID_ARGUMENT). */
    public const RESERVED_KEYS = ['from', 'message_type'];

    public const RESERVED_PREFIXES = ['google', 'gcm'];

    /**
     * @param  array<string, string>  $data  FCM only accepts string values, and no reserved key (see isReservedKey)
     * @param  array{title: string, body: string}|null  $notification  null for a data-only message
     *
     * @throws \InvalidArgumentException for a reserved data key: a mistake in our code, not something to send
     */
    public function __construct(
        public string $token,
        public array $data,
        public ?array $notification = null,
        public ?string $channelId = null,
        public bool $highPriority = false,
        public ?int $ttlSeconds = null,
    ) {
        foreach (array_keys($data) as $key) {
            if (self::isReservedKey((string) $key)) {
                throw new \InvalidArgumentException("FCM does not accept the data key [{$key}].");
            }
        }
    }

    public static function isReservedKey(string $key): bool
    {
        $lower = strtolower($key);

        if (in_array($lower, self::RESERVED_KEYS, true)) {
            return true;
        }

        foreach (self::RESERVED_PREFIXES as $prefix) {
            if (str_starts_with($lower, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /** @param  array<string, mixed>  $values */
    public static function stringify(array $values): array
    {
        return array_map(
            fn (mixed $value) => is_string($value) ? $value : (is_bool($value) ? ($value ? 'true' : 'false') : json_encode($value)),
            array_filter($values, fn (mixed $value) => $value !== null),
        );
    }

    /**
     * The `message` object of a `messages:send` request.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $android = ['priority' => $this->highPriority ? 'HIGH' : 'NORMAL'];

        if ($this->ttlSeconds !== null) {
            $android['ttl'] = max(0, $this->ttlSeconds).'s';
        }

        if ($this->notification !== null && $this->channelId !== null) {
            $android['notification'] = ['channel_id' => $this->channelId];
        }

        return array_filter([
            'token' => $this->token,
            'notification' => $this->notification,
            'data' => $this->data === [] ? null : $this->data,
            'android' => $android,
        ], fn (mixed $value) => $value !== null);
    }
}
