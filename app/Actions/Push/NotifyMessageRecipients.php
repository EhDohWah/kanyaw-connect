<?php

namespace App\Actions\Push;

use App\Models\ChatMember;
use App\Models\Message;
use App\Models\NativePushToken;
use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\NewMessageNotification;
use App\Services\PresenceService;
use App\Services\WebPushService;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Notification;
use Throwable;

class NotifyMessageRecipients
{
    public function __construct(private WebPushService $push, private PresenceService $presence) {}

    /**
     * Queue a "New message" push for the chat members who should hear about it: everyone except
     * the person who caused it, people who muted the chat, people with neither a subscribed browser
     * nor a registered phone, and (by default) people whose app is open right now and already got the
     * message live.
     *
     * Sending a message must never fail because of notifications, so problems are reported
     * (logged) and swallowed here.
     *
     * @param  string|null  $exceptUserId  defaults to the message's sender
     */
    public function handle(Message $message, ?string $exceptUserId = null): void
    {
        try {
            $recipients = $this->recipients($message, $exceptUserId ?? $message->sender_id);

            if ($recipients->isNotEmpty()) {
                Notification::send($recipients, NewMessageNotification::forMessage($message->loadMissing(['chat', 'sender'])));
            }
        } catch (Throwable $e) {
            report($e);
        }
    }

    /**
     * @return Collection<int, User>
     */
    private function recipients(Message $message, ?string $exceptUserId): Collection
    {
        $ids = ChatMember::query()
            ->where('chat_id', $message->chat_id)
            ->when($exceptUserId, fn ($query) => $query->where('user_id', '!=', $exceptUserId))
            ->notMuted()
            ->where(fn ($query) => $this->reachable($query))
            ->pluck('user_id')
            ->all();

        if ($ids !== [] && config('push.skip_online_users')) {
            $ids = array_values(array_diff($ids, $this->presence->onlineAmong($ids)));
        }

        return User::whereIn('id', $ids)->withExists(['pushSubscriptions', 'nativePushTokens'])->get();
    }

    /** People with a browser to push to (when web push is set up) or a phone. */
    private function reachable($query): void
    {
        $query->whereIn('user_id', NativePushToken::query()->select('user_id'));

        if ($this->push->isConfigured()) {
            $query->orWhereIn('user_id', PushSubscription::query()->select('user_id'));
        }
    }
}
