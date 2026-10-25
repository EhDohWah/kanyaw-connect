<?php

namespace App\Actions\Push;

use App\Models\Call;
use App\Models\ChatMember;
use App\Models\PushSubscription;
use App\Notifications\IncomingCallNotification;
use App\Notifications\MissedCallNotification;
use App\Services\PresenceService;
use App\Services\WebPushService;
use Illuminate\Support\Facades\Notification;
use Throwable;

/**
 * Pushes about calls. Like NotifyMessageRecipients, problems are reported (logged) and swallowed:
 * a call must never fail because a notification could not be queued.
 */
class NotifyCallParties
{
    public function __construct(private WebPushService $push, private PresenceService $presence) {}

    /**
     * Ring every browser of the callee. Unlike messages this ignores the "app is open" rule (the
     * open app may be on another device, or asleep in a background tab) and the chat's mute:
     * muting a chat silences its messages, not its calls.
     */
    public function incoming(Call $call): void
    {
        if (! $this->push->isConfigured()) {
            return;
        }

        try {
            $callee = $call->callee;

            if ($callee && $callee->pushSubscriptions()->exists()) {
                Notification::send($callee, IncomingCallNotification::forCall($call->loadMissing('caller')));
            }
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** Tell the callee they missed it, under the same rules as a new message (mute, app open). */
    public function missed(Call $call): void
    {
        if (! $this->push->isConfigured()) {
            return;
        }

        try {
            $wanted = ChatMember::query()
                ->where('chat_id', $call->chat_id)
                ->where('user_id', $call->callee_id)
                ->notMuted()
                ->whereIn('user_id', PushSubscription::query()->select('user_id'))
                ->exists();

            if (! $wanted || (config('push.skip_online_users') && $this->presence->onlineAmong([$call->callee_id]) !== [])) {
                return;
            }

            if ($callee = $call->callee) {
                Notification::send($callee, MissedCallNotification::forCall($call->loadMissing('caller')));
            }
        } catch (Throwable $e) {
            report($e);
        }
    }
}
