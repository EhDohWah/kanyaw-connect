<?php

namespace App\Actions\Messages;

use App\Models\Message;

class DeleteMessage
{
    /** Soft delete: the row stays for 30 days (purged in Phase 6) but disappears from the API. */
    public function handle(Message $message): void
    {
        $message->delete();
    }
}
