<?php

namespace App\Actions\Messages;

use App\Models\Message;
use App\Services\ChatBroadcaster;

class DeleteMessage
{
    public function __construct(private ChatBroadcaster $broadcaster) {}

    /**
     * Soft delete: the row stays for 30 days (purged in Phase 6) but disappears from the API.
     * An encrypted message's envelopes are deleted straight away; there is no reason to keep ciphertext.
     */
    public function handle(Message $message): void
    {
        $message->envelopes()->delete();
        $message->delete();

        $this->broadcaster->messageDeleted($message);
    }
}
