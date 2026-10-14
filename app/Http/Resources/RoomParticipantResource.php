<?php

namespace App\Http\Resources;

use App\Models\RoomParticipant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin RoomParticipant
 */
class RoomParticipantResource extends JsonResource
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
            'admission' => $this->admission,
            'joined_at' => $this->joined_at,
            'left_at' => $this->left_at,
        ];
    }
}
