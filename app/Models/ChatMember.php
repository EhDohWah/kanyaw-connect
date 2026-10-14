<?php

namespace App\Models;

use App\Enums\ChatRole;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\ChatMemberFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable([
    'chat_id', 'user_id', 'role', 'joined_at', 'last_read_message_id', 'last_read_at',
    'is_muted', 'muted_until', 'is_archived', 'pin_position',
])]
class ChatMember extends Model
{
    /** @use HasFactory<ChatMemberFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids;

    protected $attributes = [
        'role' => 'member',
        'is_muted' => false,
        'is_archived' => false,
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'role' => ChatRole::class,
            'joined_at' => 'datetime',
            'last_read_at' => 'datetime',
            'muted_until' => 'datetime',
            'is_muted' => 'boolean',
            'is_archived' => 'boolean',
            'pin_position' => 'integer',
        ];
    }

    /** Owners and admins can manage the group. */
    public function canManage(): bool
    {
        return $this->role === ChatRole::Owner || $this->role === ChatRole::Admin;
    }

    public function isOwner(): bool
    {
        return $this->role === ChatRole::Owner;
    }

    public function chat(): BelongsTo
    {
        return $this->belongsTo(Chat::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function lastReadMessage(): BelongsTo
    {
        return $this->belongsTo(Message::class, 'last_read_message_id');
    }
}
