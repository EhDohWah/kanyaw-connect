<?php

namespace App\Models;

use App\Enums\ChatType;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Carbon\CarbonInterface;
use Database\Factories\ChatFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Facades\Storage;

#[Fillable([
    'type', 'name', 'description', 'avatar_path', 'created_by', 'is_encrypted',
    'direct_key', 'member_count', 'last_message_at',
])]
class Chat extends Model
{
    /** @use HasFactory<ChatFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids, SoftDeletes;

    protected $attributes = [
        'is_encrypted' => false,
        'member_count' => 0,
    ];

    /** @var array<string, ChatMember|null> memberships already looked up on this instance, by user id */
    private array $membershipCache = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => ChatType::class,
            'is_encrypted' => 'boolean',
            'member_count' => 'integer',
            'last_message_at' => 'datetime',
        ];
    }

    /**
     * The same two users always produce the same key, whatever order they are given in. An
     * encrypted direct chat gets its own key, so two people can have a plaintext and an encrypted
     * direct chat side by side (a chat can never change from one to the other).
     */
    public static function directKeyFor(string $userA, string $userB, bool $encrypted = false): string
    {
        $ids = [$userA, $userB];
        sort($ids);

        return implode(':', $ids).($encrypted ? ':e' : '');
    }

    public function isDirect(): bool
    {
        return $this->type === ChatType::Direct;
    }

    public function isGroup(): bool
    {
        return $this->type === ChatType::Group;
    }

    public function avatarUrl(): ?string
    {
        return $this->avatar_path ? Storage::disk('public')->url($this->avatar_path) : null;
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /**
     * The membership rows (role, read state, …). Use this when you need the pivot data.
     */
    public function chatMembers(): HasMany
    {
        return $this->hasMany(ChatMember::class);
    }

    /**
     * The member users. Read-only convenience: create/delete memberships through
     * chatMembers(), because chat_members has a uuid primary key that attach() would not fill.
     */
    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'chat_members')
            ->withPivot(['role', 'joined_at', 'last_read_message_id', 'last_read_at', 'is_muted', 'muted_until', 'is_archived', 'pin_position'])
            ->withTimestamps();
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    /**
     * Only usable after scopeForUser(), which selects the latest_message_id column.
     */
    public function latestMessage(): BelongsTo
    {
        return $this->belongsTo(Message::class, 'latest_message_id');
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(Attachment::class);
    }

    /** The given user's membership row, or null when they are not a member. */
    public function membershipOf(User $user): ?ChatMember
    {
        if (! array_key_exists($user->getKey(), $this->membershipCache)) {
            $this->membershipCache[$user->getKey()] = $this->chatMembers()->where('user_id', $user->getKey())->first();
        }

        return $this->membershipCache[$user->getKey()];
    }

    /**
     * Record chat activity at $at without ever moving last_message_at backwards, even if two
     * messages finish committing out of order.
     */
    public function bumpLastMessageAt(CarbonInterface $at): void
    {
        self::whereKey($this->getKey())
            ->where(fn ($q) => $q->whereNull('last_message_at')->orWhere('last_message_at', '<', self::microseconds($at)))
            ->update(['last_message_at' => self::microseconds($at)]);
    }

    /**
     * Messages after the member's last read position that they did not send.
     * Always reads the membership fresh (not via membershipOf's cache), because callers
     * typically ask right after the read position moved.
     */
    public function unreadCountFor(User $user): int
    {
        $membership = $this->chatMembers()->where('user_id', $user->getKey())->first();

        if (! $membership) {
            return 0;
        }

        return $this->messages()
            ->incomingFor($user->getKey())
            ->when($membership->last_read_at, fn (Builder $query, $readAt) => $query->where('created_at', '>', self::microseconds($readAt)))
            ->count();
    }

    /**
     * Restrict to the user's chats and add what a chat list row needs, in one query:
     * the latest message id and the unread count.
     */
    public function scopeForUser(Builder $query, User $user): void
    {
        $query->select('chats.*')
            ->join('chat_members as my_membership', function ($join) use ($user) {
                $join->on('my_membership.chat_id', '=', 'chats.id')
                    ->where('my_membership.user_id', '=', $user->getKey());
            })
            ->addSelect([
                'latest_message_id' => Message::query()
                    ->select('messages.id')
                    ->whereColumn('messages.chat_id', 'chats.id')
                    ->orderByDesc('messages.created_at')
                    ->orderByDesc('messages.id')
                    ->limit(1),
                'unread_count' => Message::query()
                    ->selectRaw('count(*)')
                    ->incomingFor($user->getKey())
                    ->whereColumn('messages.chat_id', 'chats.id')
                    ->where(fn ($q) => $q->whereNull('my_membership.last_read_at')
                        ->orWhereColumn('messages.created_at', '>', 'my_membership.last_read_at')),
            ]);
    }
}
