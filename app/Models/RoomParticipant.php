<?php

namespace App\Models;

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\RoomParticipantFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['room_id', 'user_id', 'role', 'admission', 'joined_at', 'left_at', 'token_issued_at'])]
class RoomParticipant extends Model
{
    /** @use HasFactory<RoomParticipantFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids;

    protected $attributes = [
        'role' => 'participant',
        'admission' => 'admitted',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'role' => RoomRole::class,
            'admission' => RoomAdmission::class,
            'joined_at' => 'datetime',
            'left_at' => 'datetime',
            'token_issued_at' => 'datetime',
        ];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Connected to LiveKit right now, as far as the webhooks tell us. */
    public function isPresent(): bool
    {
        return $this->joined_at !== null && $this->left_at === null;
    }

    public function canManage(): bool
    {
        return $this->admission === RoomAdmission::Admitted
            && in_array($this->role, [RoomRole::Host, RoomRole::CoHost], true);
    }
}
