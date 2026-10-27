<?php

namespace App\Notifications\Concerns;

use App\Enums\PushPlatform;
use App\Models\NativePushToken;
use App\Services\NativePush\ApnsMessage;
use App\Services\NativePush\FcmMessage;
use App\Services\NativePush\NativePushSender;

/** The two kinds of native push the app sends. Payload values never include device tokens. */
trait BuildsNativePush
{
    /**
     * FCM refuses a message whose data uses one of its own key names, so on Android `message_type` travels as
     * `message_kind` (iOS and web push keep `message_type`). See docs/API.md, section 6.4.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, string>
     */
    protected function fcmData(array $data): array
    {
        if (array_key_exists('message_type', $data)) {
            $data['message_kind'] = $data['message_type'];
            unset($data['message_type']);
        }

        return FcmMessage::stringify($data);
    }

    /**
     * A notification the phone shows by itself: an FCM notification on an Android channel, an
     * APNs alert on iOS. `$data` travels with it so a tap can open the right screen.
     *
     * @param  array<string, mixed>  $data
     * @return list<FcmMessage|ApnsMessage>
     */
    protected function nativeAlert(NativePushToken $registration, NativePushSender $sender, string $title, string $body, array $data, string $channel, int $ttlSeconds, ?string $threadId = null): array
    {
        if ($registration->platform === PushPlatform::Android) {
            return [new FcmMessage($registration->token, $this->fcmData($data), ['title' => $title, 'body' => $body], $channel, true, $ttlSeconds)];
        }

        $aps = array_filter([
            'alert' => ['title' => $title, 'body' => $body],
            'sound' => 'default',
            'thread-id' => $threadId,
        ], fn (mixed $value) => $value !== null);

        return [new ApnsMessage($registration->token, ApnsMessage::ALERT, $sender->apnsTopic(), 10, now()->addSeconds($ttlSeconds)->getTimestamp(), ['aps' => $aps] + $data)];
    }

    /**
     * A call push, which the app handles itself (it rings, or stops ringing): a VoIP push to the
     * PushKit token on iOS (topic "<bundle>.voip", priority 10, expiring at $expiresAt), a
     * high-priority data message on Android whose TTL ends at $expiresAt. An iPhone without a PushKit
     * token gets nothing: only PushKit can wake a closed app to ring.
     *
     * @param  array<string, mixed>  $data
     * @return list<FcmMessage|ApnsMessage>
     */
    protected function nativeCallPush(NativePushToken $registration, NativePushSender $sender, array $data, int $expiresAt): array
    {
        if ($registration->platform === PushPlatform::Android) {
            return [new FcmMessage($registration->token, $this->fcmData($data), highPriority: true, ttlSeconds: max(1, $expiresAt - now()->getTimestamp()))];
        }

        if ($registration->voip_token === null) {
            return [];
        }

        return [new ApnsMessage($registration->voip_token, ApnsMessage::VOIP, $sender->apnsTopic().'.voip', 10, $expiresAt, $data)];
    }
}
