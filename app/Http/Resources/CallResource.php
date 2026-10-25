<?php

namespace App\Http\Resources;

use App\Models\Call;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A one-to-one call. Load `caller` and `callee` first (CallResource::for does), so the two
 * PublicUser objects are filled in.
 *
 * @mixin Call
 */
class CallResource extends JsonResource
{
    /** The resource with its people loaded. */
    public static function for(Call $call): self
    {
        return new self($call->loadMissing(['caller', 'callee']));
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'chat_id' => $this->chat_id,
            'room_id' => $this->room_id,
            'kind' => $this->kind,
            'status' => $this->status,
            'end_reason' => $this->end_reason,
            // null only once that account has been deleted (like a message's sender).
            'caller' => $this->caller ? new PublicUserResource($this->caller) : null,
            'callee' => $this->callee ? new PublicUserResource($this->callee) : null,
            'created_at' => $this->created_at,
            'ring_expires_at' => $this->ring_expires_at,
            'answered_at' => $this->answered_at,
            'ended_at' => $this->ended_at,
            'duration_seconds' => $this->durationSeconds(),
        ];
    }
}
