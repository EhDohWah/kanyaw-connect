<?php

namespace App\Notifications;

use App\Support\FrontendUrl;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\URL;

/**
 * "Verify your email address": Laravel's email, with the link pointing at the app's page
 * (`/verify-email?id=…&hash=…&expires=…&signature=…`). The page sends the same four values to
 * `POST /auth/email/verify/{id}/{hash}?expires=…&signature=…`.
 *
 * The signature is made for the API path alone (relative), so it does not depend on the host name
 * the app uses to reach the API.
 */
class VerifyEmailNotification extends VerifyEmail implements ShouldQueue
{
    use Queueable;

    protected function verificationUrl($notifiable): string
    {
        $id = (string) $notifiable->getKey();
        $hash = sha1($notifiable->getEmailForVerification());

        $signed = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes(config('account.verification_expire_minutes')),
            ['id' => $id, 'hash' => $hash],
            absolute: false,
        );

        parse_str((string) parse_url($signed, PHP_URL_QUERY), $query);

        return FrontendUrl::to('verify-email', [
            'id' => $id,
            'hash' => $hash,
            'expires' => (string) $query['expires'],
            'signature' => (string) $query['signature'],
        ]);
    }
}
