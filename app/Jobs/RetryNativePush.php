<?php

namespace App\Jobs;

use App\Actions\Push\DeliverNativePush;
use App\Enums\PushOutcome;
use App\Models\NativePushToken;
use App\Services\NativePush\ApnsMessage;
use App\Services\NativePush\FcmMessage;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use RuntimeException;

/**
 * Tries again to push to ONE phone after a temporary failure (timeout, 429, 5xx), so the user's
 * other phones do not get the notification twice. Never used for call pushes: they are useless late.
 */
class RetryNativePush implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 3;

    public function __construct(public string $registrationId, public FcmMessage|ApnsMessage $message) {}

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300];
    }

    public function handle(DeliverNativePush $deliver): void
    {
        $registration = NativePushToken::find($this->registrationId);

        if (! $registration) {
            return; // signed out in the meantime
        }

        if ($deliver->handle($registration, $this->message) === PushOutcome::Failed) {
            throw new RuntimeException('The push service did not accept the notification.');
        }
    }
}
