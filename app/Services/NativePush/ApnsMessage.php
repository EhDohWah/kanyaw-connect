<?php

namespace App\Services\NativePush;

/**
 * One APNs request to one iPhone: an alert (shown by the system) or a VoIP push (PushKit, which
 * wakes the app to report an incoming call to CallKit).
 */
final readonly class ApnsMessage
{
    public const ALERT = 'alert';

    public const VOIP = 'voip';

    /**
     * @param  'alert'|'voip'  $pushType
     * @param  int  $expiration  UNIX time after which APNs stops trying; 0 means "now or never"
     * @param  array<string, mixed>  $payload  the JSON body
     */
    public function __construct(
        public string $deviceToken,
        public string $pushType,
        public string $topic,
        public int $priority,
        public int $expiration,
        public array $payload,
        public ?string $collapseId = null,
    ) {}

    /** @return array<string, string> */
    public function headers(): array
    {
        return array_filter([
            'apns-push-type' => $this->pushType,
            'apns-topic' => $this->topic,
            'apns-priority' => (string) $this->priority,
            'apns-expiration' => (string) $this->expiration,
            'apns-collapse-id' => $this->collapseId,
        ], fn (?string $value) => $value !== null);
    }
}
