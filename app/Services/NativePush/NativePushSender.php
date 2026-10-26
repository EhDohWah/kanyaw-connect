<?php

namespace App\Services\NativePush;

use App\Enums\PushOutcome;
use App\Enums\PushPlatform;

/**
 * Sends native pushes: FCM HTTP v1 for Android, APNs over HTTP/2 for iOS. Tests replace it with a
 * fake (tests/Support/FakeNativePushSender).
 *
 * Implementations never log device tokens or payload bodies.
 */
interface NativePushSender
{
    /** True when the credentials for this platform are set (pushes to it are skipped otherwise). */
    public function isConfigured(PushPlatform $platform): bool;

    /**
     * Sent: the service accepted it. Expired: the service says the token is dead; remove it.
     * Failed: a temporary problem, worth trying again shortly if it is still useful.
     */
    public function send(FcmMessage|ApnsMessage $message): PushOutcome;

    /** The APNs topic of the app (its bundle identifier). VoIP pushes use "<topic>.voip". */
    public function apnsTopic(): string;
}
