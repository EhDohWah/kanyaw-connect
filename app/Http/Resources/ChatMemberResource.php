<?php

namespace App\Http\Resources;

use App\Models\ChatMember;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A member as listed in a chat (public profile + role). Not the read-state of that member.
 *
 * @mixin ChatMember
 */
class ChatMemberResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'user' => $this->whenLoaded('user', fn () => $this->user ? new PublicUserResource($this->user) : null),
            'user_id' => $this->user_id,
            'role' => $this->role,
            'joined_at' => $this->joined_at,
        ];
    }
}
