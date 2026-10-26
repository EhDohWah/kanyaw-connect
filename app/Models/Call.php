<?php

namespace App\Models;

use App\Enums\CallEndReason;
use App\Enums\CallKind;
use App\Enums\CallStatus;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\CallFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A one-to-one call in a direct chat. The media runs in an ordinary two-seat room (room_id), so
 * joining, tokens and the LiveKit webhooks are the room machinery; this row holds the ringing state.
 */
#[Fillable([
    'chat_id', 'room_id', 'caller_id', 'callee_id', 'kind', 'status', 'end_reason',
    'ring_expires_at', 'answered_at', 'ended_at',
])]
class Call extends Model
{
    /** @use HasFactory<CallFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids;

    protected $attributes = [
        'status' => 'ringing',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => CallKind::class,
            'status' => CallStatus::class,
            'end_reason' => CallEndReason::class,
            'ring_expires_at' => 'datetime',
            'answered_at' => 'datetime',
            'ended_at' => 'datetime',
        ];
    }

    public function chat(): BelongsTo
    {
        return $this->belongsTo(Chat::class);
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    public function caller(): BelongsTo
    {
        return $this->belongsTo(User::class, 'caller_id')->withTrashed();
    }

    public function callee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'callee_id')->withTrashed();
    }

    /** Ringing or ongoing. */
    public function scopeActive(Builder $query): void
    {
        $query->whereIn('calls.status', CallStatus::activeValues());
    }

    /** Calls the user made or received. */
    public function scopeInvolving(Builder $query, User|string $user): void
    {
        $id = $user instanceof User ? $user->getKey() : $user;

        $query->where(fn (Builder $q) => $q->where('calls.caller_id', $id)->orWhere('calls.callee_id', $id));
    }

    public function involves(User $user): bool
    {
        return in_array($user->getKey(), [$this->caller_id, $this->callee_id], true);
    }

    public function isVoice(): bool
    {
        return $this->kind === CallKind::Voice;
    }

    /** The other person in the call. */
    public function otherPartyId(User|string $user): string
    {
        $id = $user instanceof User ? $user->getKey() : $user;

        return $id === $this->caller_id ? $this->callee_id : $this->caller_id;
    }

    /** Has the ringing run out? A call can still say "ringing" for a moment after, until the timeout job runs. */
    public function ringExpired(): bool
    {
        return ! $this->ring_expires_at->isFuture();
    }

    /** Whole seconds between answering and ending; null until a call that was answered has ended. */
    public function durationSeconds(): ?int
    {
        if ($this->answered_at === null || $this->ended_at === null) {
            return null;
        }

        return max(0, (int) floor($this->answered_at->diffInSeconds($this->ended_at, true)));
    }
}
