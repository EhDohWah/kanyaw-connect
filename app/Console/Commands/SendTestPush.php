<?php

namespace App\Console\Commands;

use App\Actions\Push\DeliverNativePush;
use App\Enums\PushOutcome;
use App\Models\User;
use App\Notifications\Concerns\BuildsNativePush;
use App\Services\NativePush\NativePushSender;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * Checks the FCM/APNs set-up end to end: sends one ordinary notification, right now and without the
 * queue, to every phone a person registered, and says how each push service answered. Only ever
 * run by hand; it prints no tokens.
 */
#[Signature('push:test {email : The account whose phones get the notification}')]
#[Description('Send one test notification to the phones of an account (FCM and APNs)')]
class SendTestPush extends Command
{
    use BuildsNativePush;

    public function handle(NativePushSender $sender, DeliverNativePush $deliver): int
    {
        $user = User::where('email', $this->argument('email'))->first();

        if (! $user) {
            $this->error('No account has that email address.');

            return self::FAILURE;
        }

        $registrations = $user->nativePushTokens()->orderBy('created_at')->get();

        if ($registrations->isEmpty()) {
            $this->error('This account has no registered phone. Turn on notifications in the app\'s Settings first.');

            return self::FAILURE;
        }

        $rows = [];
        foreach ($registrations as $number => $registration) {
            $platform = $registration->platform;
            $outcome = 'skipped: no credentials for '.$platform->value.' (see "Phone push" in the README)';

            if ($sender->isConfigured($platform)) {
                $outcome = 'not sent';
                $messages = $this->nativeAlert($registration, $sender, config('app.name'), 'Test notification: push works on this phone.', ['type' => 'test'], 'messages', 300);

                foreach ($messages as $message) {
                    $outcome = match ($deliver->handle($registration, $message)) {
                        PushOutcome::Sent => 'sent',
                        PushOutcome::Expired => 'refused: the token is no longer valid, so the registration was removed',
                        PushOutcome::Failed => 'failed: see the log for the push service\'s answer',
                    };
                }
            }

            $rows[] = [$number + 1, $platform->value, $registration->app_version ?? '-', $registration->last_seen_at->toDateTimeString(), $outcome];
        }

        $this->table(['Phone', 'Platform', 'App version', 'Last registered', 'Result'], $rows);

        return self::SUCCESS;
    }
}
