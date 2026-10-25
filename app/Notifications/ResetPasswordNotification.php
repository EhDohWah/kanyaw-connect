<?php

namespace App\Notifications;

use App\Support\FrontendUrl;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;

/**
 * "Reset your password": Laravel's email, with the link pointing at the app's reset page
 * (`/reset-password?token=…&email=…`), which sends the new password to `POST /auth/reset-password`.
 * Queued, so asking for a link answers at once.
 */
class ResetPasswordNotification extends ResetPassword implements ShouldQueue
{
    use Queueable;

    protected function resetUrl($notifiable): string
    {
        return FrontendUrl::to('reset-password', [
            'token' => $this->token,
            'email' => $notifiable->getEmailForPasswordReset(),
        ]);
    }
}
