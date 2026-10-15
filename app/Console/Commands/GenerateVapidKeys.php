<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Minishlink\WebPush\VAPID;

#[Signature('push:vapid')]
#[Description('Generate a VAPID key pair for web push notifications')]
class GenerateVapidKeys extends Command
{
    public function handle(): int
    {
        $keys = VAPID::createVapidKeys();

        $this->line('Add these to your .env file (keep the private key secret, and keep the pair: changing it signs every browser out of push):');
        $this->newLine();
        $this->line('VAPID_PUBLIC_KEY='.$keys['publicKey']);
        $this->line('VAPID_PRIVATE_KEY='.$keys['privateKey']);
        $this->line('VAPID_SUBJECT=mailto:you@example.org');

        return self::SUCCESS;
    }
}
