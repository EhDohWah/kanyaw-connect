<?php

namespace App\Console\Commands;

use App\Actions\Cleanup\PurgeOrphanAttachments as Purge;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('attachments:purge-orphans')]
#[Description('Delete uploads that were never attached to a message')]
class PurgeOrphanAttachments extends Command
{
    public function handle(Purge $purge): int
    {
        $this->info("Deleted {$purge->handle()} orphaned attachment(s).");

        return self::SUCCESS;
    }
}
