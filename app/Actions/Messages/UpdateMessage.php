<?php

namespace App\Actions\Messages;

use App\Models\Message;
use App\Services\ChatBroadcaster;

class UpdateMessage
{
    public function __construct(private ChatBroadcaster $broadcaster) {}

    public function handle(Message $message, ?string $content): Message
    {
        $message->forceFill([
            'content' => $content,
            'is_edited' => true,
            'edited_at' => now(),
        ])->save();

        $this->broadcaster->messageUpdated($message);

        return $message;
    }
}
