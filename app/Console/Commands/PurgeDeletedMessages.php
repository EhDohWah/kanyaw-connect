<?php

namespace App\Console\Commands;

use App\Actions\Cleanup\PurgeDeletedMessages as Purge;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('messages:purge-deleted')]
#[Description('Permanently remove messages deleted more than 30 days ago, with their attachments')]
class PurgeDeletedMessages extends Command
{
    public function handle(Purge $purge): int
    {
        $result = $purge->handle();

        $this->info("Purged {$result['messages']} message(s) and {$result['attachments']} attachment(s).");

        return self::SUCCESS;
    }
}
