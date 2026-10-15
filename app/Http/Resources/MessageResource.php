<?php

namespace App\Http\Resources;

use App\Models\Message;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;

/**
 * @mixin Message
 */
class MessageResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'chat_id' => $this->chat_id,
            'sender' => $this->whenLoaded('sender', fn () => $this->sender ? new PublicUserResource($this->sender) : null),
            'sender_id' => $this->sender_id,
            'type' => $this->type,
            'content' => $this->content,
            'reply_to_id' => $this->reply_to_id,
            'reply_to' => $this->whenLoaded('replyTo', fn () => $this->replyTo ? $this->replyPreview() : null),
            // Only the sender needs their own idempotency key (to match the optimistic message they showed).
            'client_id' => $this->when($request->user()?->getKey() === $this->sender_id, $this->client_id),
            'is_edited' => $this->is_edited,
            'edited_at' => $this->edited_at,
            'metadata' => (object) ($this->metadata ?? []),
            // True for messages in encrypted chats: `content` is then always null and the text is in `envelope`.
            'encrypted' => $this->isEncrypted(),
            // The calling device's own encrypted copy (needs the X-Device-Id header). Null when this
            // device has none: it was added after the message was sent, or it sent the message itself.
            // Absent from broadcasts and from requests that name no device. Never another device's copy.
            'envelope' => $this->whenLoaded('envelopes', fn () => ($envelope = $this->envelopes->first()) ? new EnvelopeResource($envelope) : null),
            'attachment' => $this->whenLoaded('attachment', fn () => $this->attachment ? new AttachmentResource($this->attachment) : null),
            'created_at' => $this->created_at,
        ];
    }

    /**
     * A small preview of the replied-to message; the content is dropped if that message was deleted.
     *
     * @return array<string, mixed>
     */
    private function replyPreview(): array
    {
        $deleted = $this->replyTo->trashed();

        return [
            'id' => $this->replyTo->id,
            'sender_id' => $this->replyTo->sender_id,
            'type' => $this->replyTo->type,
            'content' => $deleted ? null : Str::limit((string) $this->replyTo->content, 140),
            'is_deleted' => $deleted,
        ];
    }
}
