<?php

namespace App\Models;

use App\Enums\MessageType;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\MessageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable(['chat_id', 'sender_id', 'type', 'content', 'reply_to_id', 'client_id', 'is_edited', 'edited_at', 'metadata'])]
class Message extends Model
{
    /** @use HasFactory<MessageFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids, SoftDeletes;

    protected $attributes = [
        'type' => 'text',
        'is_edited' => false,
        'metadata' => '{}',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => MessageType::class,
            'is_edited' => 'boolean',
            'edited_at' => 'datetime',
            'metadata' => 'array',
        ];
    }

    public function chat(): BelongsTo
    {
        return $this->belongsTo(Chat::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'sender_id')->withTrashed(); // a deleted account shows as "Deleted user"
    }

    /** The message this one replies to. Includes deleted ones so a reply can show "message deleted". */
    public function replyTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reply_to_id')->withTrashed();
    }

    /** The encrypted copies of this message, one per recipient device (encrypted chats only). */
    public function envelopes(): HasMany
    {
        return $this->hasMany(MessageEnvelope::class);
    }

    /**
     * Messages in encrypted chats record which device sent them. That, not the absence of content,
     * is what marks a message as encrypted.
     */
    public function isEncrypted(): bool
    {
        return isset($this->metadata['sender_device_id']);
    }

    public function attachment(): HasOne
    {
        return $this->hasOne(Attachment::class);
    }

    /**
     * Messages that can count as unread for a user: not their own, and not system notices, except
     * a missed call, which counts for the person who missed it (not for the one who called).
     * (sender_id is null for system messages, so a plain "<>" comparison would drop them silently.)
     */
    public function scopeIncomingFor(Builder $query, string $userId): void
    {
        $query->where(fn (Builder $q) => $q
            ->where(fn (Builder $message) => $message
                ->where('messages.type', '!=', MessageType::System->value)
                ->whereRaw('messages.sender_id is distinct from ?', [$userId]))
            ->orWhere(fn (Builder $missedCall) => $missedCall
                ->where('messages.type', MessageType::System->value)
                ->whereRaw("messages.metadata->>'event' = 'call'")
                ->whereRaw("messages.metadata->>'status' = 'missed'")
                ->whereRaw("messages.metadata->>'caller_id' is distinct from ?", [$userId])));
    }

    /** Can the sender still edit this message? */
    public function isWithinEditWindow(): bool
    {
        return $this->created_at->gt(now()->subHours(config('chat.edit_window_hours')));
    }
}
