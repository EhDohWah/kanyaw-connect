<?php

namespace App\Models;

use App\Enums\RoomAuditAction;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

#[Fillable(['room_id', 'actor_id', 'target_user_id', 'action', 'metadata', 'created_at'])]
class RoomAuditLog extends Model
{
    use HasMicrosecondTimestamps, HasUuids;

    /** Entries are written once and never changed, so there is no updated_at. */
    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['action' => RoomAuditAction::class, 'metadata' => 'array', 'created_at' => 'datetime'];
    }

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function target(): BelongsTo
    {
        return $this->belongsTo(User::class, 'target_user_id');
    }
}
