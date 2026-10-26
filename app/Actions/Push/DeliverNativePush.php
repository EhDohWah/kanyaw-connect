<?php

namespace App\Actions\Push;

use App\Enums\PushOutcome;
use App\Models\NativePushToken;
use App\Services\NativePush\ApnsMessage;
use App\Services\NativePush\FcmMessage;
use App\Services\NativePush\NativePushSender;

class DeliverNativePush
{
    public function __construct(private NativePushSender $sender) {}

    /**
     * Send one message to one phone. A token the push service reports as dead is forgotten on the
     * spot: a dead PushKit token only loses the phone its call ringing, a dead FCM or APNs device
     * token removes the whole registration.
     */
    public function handle(NativePushToken $registration, FcmMessage|ApnsMessage $message): PushOutcome
    {
        $outcome = $this->sender->send($message);

        if ($outcome === PushOutcome::Expired) {
            $voip = $message instanceof ApnsMessage && $message->pushType === ApnsMessage::VOIP
                && $message->deviceToken === $registration->voip_token;

            $voip ? $registration->forceFill(['voip_token' => null])->save() : $registration->delete();
        }

        return $outcome;
    }
}
