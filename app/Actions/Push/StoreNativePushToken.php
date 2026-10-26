<?php

namespace App\Actions\Push;

use App\Models\NativePushToken;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\PersonalAccessToken;

class StoreNativePushToken
{
    /**
     * Register this phone for the user, or refresh it if the token is already known.
     *
     * A push token belongs to one app installation. If it is stored for someone else (the phone
     * was handed to another person who signed in), it moves to the current user, so the previous
     * owner's notifications and calls stop arriving there. The same goes for a PushKit token.
     *
     * The registration is tied to the current login token: signing out deletes it.
     *
     * @param  array{platform: string, token: string, voip_token?: string|null, app_version?: string|null}  $data
     * @return array{0: NativePushToken, 1: bool} the registration, and whether it is new
     *
     * @throws ValidationException when the user already has the maximum number of registrations
     */
    public function handle(User $user, PersonalAccessToken $accessToken, array $data): array
    {
        try {
            return DB::transaction(fn () => $this->upsert($user, $accessToken, $data));
        } catch (UniqueConstraintViolationException) {
            // The same token was registered twice at once; the other request created it, so update that one.
            return DB::transaction(fn () => $this->upsert($user, $accessToken, $data));
        }
    }

    /**
     * @param  array{platform: string, token: string, voip_token?: string|null, app_version?: string|null}  $data
     * @return array{0: NativePushToken, 1: bool}
     */
    private function upsert(User $user, PersonalAccessToken $accessToken, array $data): array
    {
        $registration = NativePushToken::where('token', $data['token'])->lockForUpdate()->first();

        if (! $registration && $user->nativePushTokens()->count() >= config('push.native.max_tokens_per_user')) {
            throw ValidationException::withMessages([
                'token' => ['You have too many phones registered for notifications. Sign out on one you no longer use first.'],
            ]);
        }

        $voipToken = $data['voip_token'] ?? null;

        if ($voipToken !== null) {
            // A PushKit token rings one installation: it must not stay on an older registration.
            NativePushToken::where('voip_token', $voipToken)
                ->when($registration, fn ($query) => $query->whereKeyNot($registration->getKey()))
                ->update(['voip_token' => null]);
        }

        $registration ??= new NativePushToken(['token' => $data['token']]);
        $created = ! $registration->exists;

        $registration->forceFill([
            'user_id' => $user->getKey(),
            'personal_access_token_id' => $accessToken->getKey(),
            'platform' => $data['platform'],
            'voip_token' => $voipToken,
            'app_version' => $data['app_version'] ?? null,
            'last_seen_at' => now(),
        ])->save();

        return [$registration, $created];
    }
}
