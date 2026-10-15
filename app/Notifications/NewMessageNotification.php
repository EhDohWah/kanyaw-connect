<?php

namespace App\Notifications;

use App\Enums\ChatType;
use App\Enums\MessageType;
use App\Models\Message;
use App\Notifications\Channels\WebPushChannel;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Notification;
use Illuminate\Support\Str;

/**
 * "You have a new message", sent to the recipient's browsers by web push.
 *
 * The text is decided here, when the message is sent, and only the finished payload is queued. For
 * an end-to-end encrypted chat that is just "New message": no sender, no chat name, no preview.
 * (The chat and message ids are in the payload so the app can open the right conversation; the
 * payload itself is encrypted so that only the browser can read it, not the push service.)
 */
class NewMessageNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public const GENERIC_BODY = 'New message';

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(public array $payload) {}

    /**
     * The message must be loaded with its chat and sender.
     */
    public static function forMessage(Message $message): self
    {
        $chat = $message->chat;

        $payload = [
            'type' => 'message.new',
            'chat_id' => $chat->getKey(),
            'message_id' => $message->getKey(),
            'sent_at' => $message->created_at->toJSON(), // same format as the API
            'encrypted' => (bool) $chat->is_encrypted,
        ];

        if ($chat->is_encrypted) {
            return new self($payload + ['title' => config('app.name'), 'body' => self::GENERIC_BODY]);
        }

        $sender = $message->sender;
        $group = $chat->type === ChatType::Group;

        $title = $group ? ($chat->name ?: config('app.name')) : ($sender?->name ?: config('app.name'));
        $preview = config('push.show_preview') ? self::preview($message) : null;

        $body = match (true) {
            $preview === null => self::GENERIC_BODY,
            $group && $sender => "{$sender->name}: {$preview}",
            default => $preview,
        };

        $payload += [
            'title' => Str::limit($title, 80),
            'body' => $body,
            'message_type' => $message->type->value,
        ];

        // A "video room started" notice should open the room.
        if (isset($message->metadata['room_id'])) {
            $payload['room_id'] = $message->metadata['room_id'];
        }

        return new self($payload);
    }

    /**
     * @return list<class-string>
     */
    public function via(object $notifiable): array
    {
        return [WebPushChannel::class];
    }

    /**
     * @return array<string, mixed>
     */
    public function toWebPush(object $notifiable): array
    {
        return $this->payload;
    }

    private static function preview(Message $message): string
    {
        return match ($message->type) {
            MessageType::Image => 'Sent a photo',
            MessageType::Voice => 'Sent a voice message',
            MessageType::File => 'Sent a file',
            default => self::firstCharacters(trim(preg_replace('/\s+/u', ' ', (string) $message->content)), config('push.preview_length')) ?: self::GENERIC_BODY,
        };
    }

    /**
     * The first $length characters as people perceive them: Karen and Burmese text builds one
     * character from a base letter plus combining marks, which must not be cut apart.
     */
    private static function firstCharacters(string $text, int $length): string
    {
        preg_match_all('/\X/u', $text, $matches);
        $characters = $matches[0];

        return count($characters) > $length
            ? implode('', array_slice($characters, 0, $length)).'…'
            : $text;
    }
}
