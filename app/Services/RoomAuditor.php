<?php

namespace App\Services;

use App\Enums\RoomAuditAction;
use App\Models\Room;
use App\Models\RoomAuditLog;
use App\Models\User;

/**
 * Writes the room audit log. Actions call this inside the same database transaction as the change
 * they describe, so an entry exists exactly when the change does.
 */
class RoomAuditor
{
    /**
     * @param  User|null  $actor  who did it; null when the system did
     * @param  User|string|null  $target  who it was done to (a user, or a user id)
     * @param  array<string, scalar|null>  $metadata  small facts about the action; never secrets
     */
    public function record(Room $room, RoomAuditAction $action, ?User $actor, User|string|null $target = null, array $metadata = []): RoomAuditLog
    {
        return RoomAuditLog::create([
            'room_id' => $room->getKey(),
            'actor_id' => $actor?->getKey(),
            'target_user_id' => $target instanceof User ? $target->getKey() : $target,
            'action' => $action,
            'created_at' => now(),
            // Left out when empty so the column default '{}' applies (an empty PHP array would be stored as '[]').
            ...($metadata === [] ? [] : ['metadata' => $metadata]),
        ]);
    }
}
