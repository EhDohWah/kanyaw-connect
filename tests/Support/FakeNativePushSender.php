<?php

namespace Tests\Support;

use App\Enums\PushOutcome;
use App\Enums\PushPlatform;
use App\Services\NativePush\ApnsMessage;
use App\Services\NativePush\FcmMessage;
use App\Services\NativePush\NativePushSender;

/**
 * Stands in for the FCM/APNs sender in tests: records every message and never touches the network.
 */
class FakeNativePushSender implements NativePushSender
{
    /** @var array<string, bool> per platform value */
    public array $configured = ['android' => true, 'ios' => true];

    /** @var list<FcmMessage|ApnsMessage> */
    public array $sent = [];

    /** @var array<string, PushOutcome> outcome per device token; anything not listed is Sent */
    public array $outcomes = [];

    public function isConfigured(PushPlatform $platform): bool
    {
        return $this->configured[$platform->value];
    }

    public function send(FcmMessage|ApnsMessage $message): PushOutcome
    {
        $this->sent[] = $message;

        return $this->outcomes[$message instanceof FcmMessage ? $message->token : $message->deviceToken] ?? PushOutcome::Sent;
    }

    public function apnsTopic(): string
    {
        return 'org.example.kanyawconnect';
    }

    /** @return list<FcmMessage> */
    public function fcm(): array
    {
        return array_values(array_filter($this->sent, fn ($m) => $m instanceof FcmMessage));
    }

    /** @return list<ApnsMessage> */
    public function apns(?string $pushType = null): array
    {
        return array_values(array_filter($this->sent, fn ($m) => $m instanceof ApnsMessage && ($pushType === null || $m->pushType === $pushType)));
    }

    /** @return list<FcmMessage|ApnsMessage> everything sent to this device token */
    public function to(string $token): array
    {
        return array_values(array_filter($this->sent, fn ($m) => ($m instanceof FcmMessage ? $m->token : $m->deviceToken) === $token));
    }
}
