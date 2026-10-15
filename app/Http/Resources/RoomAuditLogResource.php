<?php

namespace App\Http\Resources;

use App\Models\RoomAuditLog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin RoomAuditLog
 */
class RoomAuditLogResource extends JsonResource
{
    /**
     * `actor` is null when the system did it. `metadata` is a small object whose keys depend on `action`.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'action' => $this->action,
            'actor' => $this->actor ? new PublicUserResource($this->actor) : null,
            'target' => $this->target ? new PublicUserResource($this->target) : null,
            'metadata' => (object) ($this->metadata ?? []),
            'created_at' => $this->created_at,
        ];
    }
}
