<?php

namespace App\Console\Commands;

use App\Services\PresenceService;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('presence:mark-offline')]
#[Description('Mark users offline when their heartbeat has expired')]
class MarkStaleUsersOffline extends Command
{
    public function handle(PresenceService $presence): int
    {
        $count = $presence->markStaleOffline();

        $this->info("Marked {$count} user(s) offline.");

        return self::SUCCESS;
    }
}
