<?php

namespace App\Http\Resources;

use App\Models\ChatMember;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The authenticated user's own membership: role, read position and notification preferences.
 *
 * @mixin ChatMember
 */
class MyMembershipResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'role' => $this->role,
            'joined_at' => $this->joined_at,
            'last_read_message_id' => $this->last_read_message_id,
            'last_read_at' => $this->last_read_at,
            'is_muted' => $this->is_muted,
            'muted_until' => $this->muted_until,
            'is_archived' => $this->is_archived,
            'pin_position' => $this->pin_position,
        ];
    }
}
