<?php

namespace App\Notifications;

use App\Support\FrontendUrl;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Tells the person their password was changed (in Settings) or reset (from an emailed link), so a
 * change they did not make does not go unnoticed. The button starts a reset.
 */
class PasswordChangedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  'changed'|'reset'  $how
     */
    public function __construct(public readonly string $how) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject(__('Your password was changed'))
            ->line($this->how === 'reset'
                ? __('The password of your :app account was reset with a link sent to this address. Every device has been signed out.', ['app' => config('app.name')])
                : __('The password of your :app account was changed. Your other devices have been signed out.', ['app' => config('app.name')]))
            ->line(__('If you did not do this, reset your password now.'))
            ->action(__('Reset password'), FrontendUrl::to('forgot-password'));
    }
}
