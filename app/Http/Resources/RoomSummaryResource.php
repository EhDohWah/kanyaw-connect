<?php

namespace App\Http\Resources;

use App\Models\Room;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A room without anything specific to one viewer, small enough to broadcast.
 *
 * @mixin Room
 */
class RoomSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'type' => $this->type,
            'status' => $this->status,
            'host_id' => $this->host_id,
            'chat_id' => $this->chat_id,
            'is_locked' => $this->is_locked,
        ];
    }
}
