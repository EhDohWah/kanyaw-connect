<?php

namespace App\Actions\Push;

use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class StorePushSubscription
{
    /**
     * Register this browser for the user, or refresh it if the endpoint is already known.
     *
     * An endpoint belongs to one browser, so if it is already stored for someone else (the browser
     * was handed to another person who signed in), it moves to the current user: the previous
     * owner's notifications must not keep arriving there.
     *
     * The subscription is tied to the login it was made with, so signing out ends it.
     *
     * @param  array{endpoint: string, keys: array{p256dh: string, auth: string}}  $data
     * @return array{0: PushSubscription, 1: bool} the subscription, and whether it is new
     *
     * @throws ValidationException when the user already has the maximum number of subscriptions
     */
    public function handle(User $user, array $data): array
    {
        try {
            return DB::transaction(fn () => $this->upsert($user, $data));
        } catch (UniqueConstraintViolationException) {
            // The same endpoint was registered twice at once; the other request created it, so update that one.
            return DB::transaction(fn () => $this->upsert($user, $data));
        }
    }

    /**
     * @param  array{endpoint: string, keys: array{p256dh: string, auth: string}}  $data
     * @return array{0: PushSubscription, 1: bool}
     */
    private function upsert(User $user, array $data): array
    {
        $subscription = PushSubscription::where('endpoint', $data['endpoint'])->lockForUpdate()->first();

        if (! $subscription && $user->pushSubscriptions()->count() >= config('push.max_subscriptions_per_user')) {
            throw ValidationException::withMessages([
                'endpoint' => ['You have too many push subscriptions. Remove one you no longer use first.'],
            ]);
        }

        // A real, stored token (not the transient one a cookie session or a test login carries).
        $token = $user->currentAccessToken();
        $tokenId = $token instanceof PersonalAccessToken && $token->exists ? $token->getKey() : null;

        $subscription ??= new PushSubscription(['endpoint' => $data['endpoint']]);
        $created = ! $subscription->exists;

        $subscription->forceFill([
            'user_id' => $user->getKey(),
            'access_token_id' => $tokenId,
            'p256dh_key' => $data['keys']['p256dh'],
            'auth_key' => $data['keys']['auth'],
        ])->save();

        return [$subscription, $created];
    }
}
