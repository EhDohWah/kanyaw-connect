<?php

namespace App\Actions\Messages;

use App\Models\Message;

class UpdateMessage
{
    public function handle(Message $message, ?string $content): Message
    {
        $message->forceFill([
            'content' => $content,
            'is_edited' => true,
            'edited_at' => now(),
        ])->save();

        return $message;
    }
}
