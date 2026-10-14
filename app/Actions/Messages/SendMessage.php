<?php

namespace App\Actions\Messages;

use App\Enums\MessageType;
use App\Models\Attachment;
use App\Models\Chat;
use App\Models\Message;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

class SendMessage
{
    /**
     * Send a message. Idempotent on (sender, client_id): a retry returns the original message.
     *
     * @param  array{client_id: string, type: string, content?: string|null, reply_to_id?: string|null, metadata?: array{attachment_id?: string}}  $data
     * @return array{0: Message, 1: bool} the message, and whether it was newly created
     *
     * @throws ConflictHttpException when the client_id was already used for a different chat
     * @throws ValidationException when the attachment cannot be used
     */
    public function handle(Chat $chat, User $sender, array $data): array
    {
        if ($existing = $this->findExisting($sender, $data['client_id'])) {
            return [$this->assertSameChat($existing, $chat), false];
        }

        try {
            $message = DB::transaction(fn () => $this->create($chat, $sender, $data));
        } catch (UniqueConstraintViolationException $e) {
            // The same client_id was submitted twice at once; the other request won.
            $existing = $this->findExisting($sender, $data['client_id']);

            if (! $existing) {
                throw $e;
            }

            return [$this->assertSameChat($existing, $chat), false];
        }

        return [$message, true];
    }

    private function create(Chat $chat, User $sender, array $data): Message
    {
        $type = MessageType::from($data['type']);
        $attachmentId = $type === MessageType::Text ? null : ($data['metadata']['attachment_id'] ?? null);

        $attachment = $attachmentId ? $this->claimAttachment($chat, $sender, $type, $attachmentId) : null;

        $message = Message::create([
            'chat_id' => $chat->getKey(),
            'sender_id' => $sender->getKey(),
            'type' => $type,
            'content' => $data['content'] ?? null,
            'reply_to_id' => $data['reply_to_id'] ?? null,
            'client_id' => $data['client_id'],
            // Left out for plain text so the column default '{}' applies (an empty PHP array would
            // be stored as '[]', and a '{}' string would be double-encoded by the array cast).
            ...($attachment ? ['metadata' => ['attachment_id' => $attachment->getKey()]] : []),
        ]);

        $attachment?->update(['message_id' => $message->getKey()]);

        // Keep the chat's activity time monotonic even if two sends finish out of order.
        Chat::whereKey($chat->getKey())
            ->where(fn ($q) => $q->whereNull('last_message_at')->orWhere('last_message_at', '<', Message::microseconds($message->created_at)))
            ->update(['last_message_at' => Message::microseconds($message->created_at)]);

        // Sending a message means the sender has read everything up to it.
        $chat->chatMembers()->where('user_id', $sender->getKey())->update([
            'last_read_message_id' => $message->getKey(),
            'last_read_at' => Message::microseconds($message->created_at),
        ]);

        return $message;
    }

    /**
     * Lock the attachment so two messages cannot claim it at once, and check it is usable here.
     */
    private function claimAttachment(Chat $chat, User $sender, MessageType $type, string $attachmentId): Attachment
    {
        $attachment = Attachment::whereKey($attachmentId)
            ->where('chat_id', $chat->getKey())
            ->where('uploader_id', $sender->getKey())
            ->whereNull('message_id')
            ->lockForUpdate()
            ->first();

        if (! $attachment) {
            throw ValidationException::withMessages([
                'metadata.attachment_id' => ['That attachment does not exist, is not yours, or is already used.'],
            ]);
        }

        $expectedPrefix = match ($type) {
            MessageType::Image => 'image/',
            MessageType::Voice => 'audio/',
            default => null,
        };

        if ($expectedPrefix && ! str_starts_with($attachment->mime_type, $expectedPrefix)) {
            throw ValidationException::withMessages([
                'metadata.attachment_id' => ["A {$type->value} message needs a {$expectedPrefix}* attachment."],
            ]);
        }

        return $attachment;
    }

    private function findExisting(User $sender, string $clientId): ?Message
    {
        return Message::withTrashed()
            ->where('sender_id', $sender->getKey())
            ->where('client_id', $clientId)
            ->first();
    }

    private function assertSameChat(Message $existing, Chat $chat): Message
    {
        if ($existing->chat_id !== $chat->getKey() || $existing->trashed()) {
            throw new ConflictHttpException('This client_id was already used for a different message.');
        }

        return $existing;
    }
}
