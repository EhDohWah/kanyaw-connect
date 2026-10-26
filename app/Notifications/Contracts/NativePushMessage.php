<?php

namespace App\Notifications\Contracts;

use App\Models\NativePushToken;
use App\Services\NativePush\ApnsMessage;
use App\Services\NativePush\FcmMessage;
use App\Services\NativePush\NativePushSender;

/** A notification that NativePushChannel can deliver to a user's phones. */
interface NativePushMessage
{
    /**
     * The messages for one phone (none to skip it, for example an iPhone without a PushKit token
     * for an incoming call).
     *
     * @return list<FcmMessage|ApnsMessage>
     */
    public function toNativePush(NativePushToken $registration, NativePushSender $sender): array;

    /** Whether a temporary failure is tried once more 30 seconds later (never for call pushes). */
    public function retryNativePush(): bool;
}
