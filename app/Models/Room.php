<?php

namespace App\Models;

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Enums\RoomStatus;
use App\Enums\RoomType;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\RoomFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

#[Fillable([
    'type', 'name', 'description', 'host_id', 'chat_id', 'password', 'waiting_room_enabled', 'is_locked',
    'max_participants', 'scheduled_at', 'duration_minutes', 'status', 'started_at', 'ended_at',
    'livekit_room_name', 'recording_enabled', 'settings',
])]
#[Hidden(['password', 'livekit_room_name'])]
class Room extends Model
{
    /** @use HasFactory<RoomFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids, SoftDeletes;

    protected $attributes = [
        'type' => 'instant',
        'status' => 'waiting',
        'waiting_room_enabled' => false,
        'is_locked' => false,
        'max_participants' => 50,
        'recording_enabled' => false,
        'settings' => '{}',
    ];

    /** @var array<string, RoomParticipant|null> participants already looked up on this instance, by user id */
    private array $participantCache = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => RoomType::class,
            'status' => RoomStatus::class,
            'password' => 'hashed',
            'waiting_room_enabled' => 'boolean',
            'is_locked' => 'boolean',
            'max_participants' => 'integer',
            'duration_minutes' => 'integer',
            'scheduled_at' => 'datetime',
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'recording_enabled' => 'boolean',
            'settings' => 'array',
        ];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'host_id');
    }

    public function chat(): BelongsTo
    {
        return $this->belongsTo(Chat::class);
    }

    public function participants(): HasMany
    {
        return $this->hasMany(RoomParticipant::class);
    }

    public function auditLogs(): HasMany
    {
        return $this->hasMany(RoomAuditLog::class);
    }

    /** People waiting to be let in. */
    public function waitingParticipants(): HasMany
    {
        return $this->hasMany(RoomParticipant::class)->where('admission', RoomAdmission::Waiting->value);
    }

    public function hasPassword(): bool
    {
        return $this->password !== null;
    }

    public function hasEnded(): bool
    {
        return $this->status === RoomStatus::Ended;
    }

    /** The user's row for this room, or null if they never asked to join. Cached per instance. */
    public function participantFor(User $user): ?RoomParticipant
    {
        if (! array_key_exists($user->getKey(), $this->participantCache)) {
            $this->participantCache[$user->getKey()] = $this->participants()->where('user_id', $user->getKey())->first();
        }

        return $this->participantCache[$user->getKey()];
    }

    /** Is this user the host or a co-host (an admitted one)? */
    public function isManagedBy(User $user): bool
    {
        $participant = $this->participantFor($user);

        return $participant?->admission === RoomAdmission::Admitted
            && in_array($participant->role, [RoomRole::Host, RoomRole::CoHost], true);
    }

    /**
     * How many seats are taken by people other than $except: everyone LiveKit says is connected,
     * plus people who were handed a token moments ago and have not connected yet.
     */
    public function seatsTakenExcept(User $except): int
    {
        $holdCutoff = RoomParticipant::microseconds(now()->subSeconds(config('rooms.seat_hold_seconds')));

        return $this->participants()
            ->where('user_id', '!=', $except->getKey())
            ->where('admission', RoomAdmission::Admitted->value)
            ->where(fn (Builder $query) => $query
                // connected now
                ->where(fn (Builder $q) => $q->whereNotNull('joined_at')->whereNull('left_at'))
                // or holding a fresh token without being connected
                ->orWhere(fn (Builder $q) => $q
                    ->where('token_issued_at', '>', $holdCutoff)
                    ->where(fn (Builder $p) => $p->whereNull('joined_at')->orWhereNotNull('left_at'))))
            ->count();
    }

    /** Rooms the user hosts, was invited to through a chat, or has asked to join. */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query->where(fn (Builder $q) => $q
            ->where('rooms.host_id', $user->getKey())
            ->orWhereIn('rooms.id', RoomParticipant::select('room_id')->where('user_id', $user->getKey()))
            ->orWhereIn('rooms.chat_id', ChatMember::select('chat_id')->where('user_id', $user->getKey())));
    }
}
