<?php

namespace App\Actions\Messages;

use App\Actions\Push\NotifyMessageRecipients;
use App\Enums\MessageType;
use App\Exceptions\EncryptionConflictException;
use App\Models\Attachment;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Device;
use App\Models\Message;
use App\Models\MessageEnvelope;
use App\Models\User;
use App\Services\ChatBroadcaster;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

class SendMessage
{
    public function __construct(private ChatBroadcaster $broadcaster, private NotifyMessageRecipients $notifier) {}

    /**
     * Send a message. Idempotent on (sender, client_id): a retry returns the original message.
     *
     * In an encrypted chat the message has no content: it carries `envelopes` (one per recipient device)
     * and is sent from $device. The server checks that the envelopes cover exactly the right devices,
     * then stores them untouched; it never reads them.
     *
     * @param  array{client_id: string, type: string, content?: string|null, reply_to_id?: string|null, metadata?: array{attachment_id?: string, duration_ms?: int, waveform?: list<int>}, envelopes?: list<array{recipient_device_id: string, ciphertext: string, header: array<string, mixed>}>}  $data
     * @return array{0: Message, 1: bool} the message, and whether it was newly created
     *
     * @throws ConflictHttpException when the client_id was already used for a different chat
     * @throws ValidationException when the attachment cannot be used
     * @throws EncryptionConflictException when the envelopes do not match the chat members' devices
     */
    public function handle(Chat $chat, User $sender, array $data, ?Device $device = null): array
    {
        if ($existing = $this->findExisting($sender, $data['client_id'])) {
            return [$this->assertSameChat($existing, $chat), false];
        }

        try {
            $message = DB::transaction(fn () => $this->create($chat, $sender, $data, $device));
        } catch (UniqueConstraintViolationException $e) {
            // The same client_id was submitted twice at once; the other request won.
            $existing = $this->findExisting($sender, $data['client_id']);

            if (! $existing) {
                throw $e;
            }

            return [$this->assertSameChat($existing, $chat), false];
        }

        $this->broadcaster->messageSent($message);
        $this->notifier->handle($message);

        return [$message, true];
    }

    private function create(Chat $chat, User $sender, array $data, ?Device $device): Message
    {
        $type = MessageType::from($data['type']);
        $attachmentId = $type === MessageType::Text ? null : ($data['metadata']['attachment_id'] ?? null);

        $encrypted = $chat->is_encrypted;

        if ($encrypted) {
            // Plaintext must never be stored in an encrypted chat, whatever the caller did.
            if (($data['content'] ?? null) !== null) {
                throw ValidationException::withMessages(['content' => ['Encrypted chats do not accept plaintext content.']]);
            }

            $this->assertEnvelopesCoverChat($chat, $device, $data['envelopes'] ?? []);
        }

        $attachment = $attachmentId ? $this->claimAttachment($chat, $sender, $type, $attachmentId) : null;

        $metadata = array_filter([
            // Recipients need to know which device sent an encrypted message (to pick the right session).
            'sender_device_id' => $encrypted ? $device->getKey() : null,
            'attachment_id' => $attachment?->getKey(),
            // A voice message's length and waveform, as the sender measured them (validated as voice-only).
            'duration_ms' => $type === MessageType::Voice ? ($data['metadata']['duration_ms'] ?? null) : null,
            'waveform' => $type === MessageType::Voice ? ($data['metadata']['waveform'] ?? null) : null,
        ], fn ($value) => $value !== null);

        $message = Message::create([
            'chat_id' => $chat->getKey(),
            'sender_id' => $sender->getKey(),
            'type' => $type,
            'content' => $encrypted ? null : ($data['content'] ?? null),
            'reply_to_id' => $data['reply_to_id'] ?? null,
            'client_id' => $data['client_id'],
            // Left out when empty so the column default '{}' applies (an empty PHP array would
            // be stored as '[]', and a '{}' string would be double-encoded by the array cast).
            ...($metadata ? ['metadata' => $metadata] : []),
        ]);

        if ($encrypted) {
            $this->storeEnvelopes($message, $data['envelopes']);
        }

        $attachment?->update(['message_id' => $message->getKey()]);

        $chat->bumpLastMessageAt($message->created_at);

        // Sending a message means the sender has read everything up to it.
        $chat->chatMembers()->where('user_id', $sender->getKey())->update([
            'last_read_message_id' => $message->getKey(),
            'last_read_at' => Message::microseconds($message->created_at),
        ]);

        return $message;
    }

    /**
     * Every active device of every member must get an envelope, except the sending device (which
     * already has the plaintext; it may include one for itself, but need not). That includes the
     * sender's own other devices. Envelopes for any other device (revoked, or not a member's) are refused.
     *
     * The chat row is locked FOR SHARE while checking, which serialises with member removal (which
     * locks it FOR UPDATE): a member cannot be removed halfway through and still receive this message.
     *
     * @param  list<array{recipient_device_id: string}>  $envelopes
     *
     * @throws EncryptionConflictException
     */
    private function assertEnvelopesCoverChat(Chat $chat, Device $sendingDevice, array $envelopes): void
    {
        Chat::whereKey($chat->getKey())->sharedLock()->first();

        $required = Device::active()
            ->whereIn('user_id', User::query()->select('id')->whereIn('id', ChatMember::select('user_id')->where('chat_id', $chat->getKey())))
            ->where('devices.id', '!=', $sendingDevice->getKey())
            ->pluck('devices.id')
            ->all();

        if ($required === []) {
            throw EncryptionConflictException::noRecipientDevices();
        }

        $given = array_column($envelopes, 'recipient_device_id');

        $missing = array_diff($required, $given);
        $unexpected = array_diff($given, [...$required, $sendingDevice->getKey()]);

        if ($missing !== [] || $unexpected !== []) {
            throw EncryptionConflictException::envelopeMismatch($missing, $unexpected);
        }
    }

    /**
     * Store the envelopes exactly as received. `ciphertext` and `header` are never decoded, read or altered.
     *
     * @param  list<array{recipient_device_id: string, ciphertext: string, header: array<string, mixed>}>  $envelopes
     */
    private function storeEnvelopes(Message $message, array $envelopes): void
    {
        $now = MessageEnvelope::microseconds(now());

        MessageEnvelope::insert(array_map(fn (array $envelope) => [
            'id' => (string) Str::uuid7(),
            'message_id' => $message->getKey(),
            'recipient_device_id' => $envelope['recipient_device_id'],
            'ciphertext' => $envelope['ciphertext'],
            'header' => json_encode($envelope['header']),
            'created_at' => $now,
            'updated_at' => $now,
        ], $envelopes));
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

        // An encrypted attachment is an opaque blob, so its type cannot be checked.
        if ($expectedPrefix && ! $chat->is_encrypted && ! str_starts_with($attachment->mime_type, $expectedPrefix)) {
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
