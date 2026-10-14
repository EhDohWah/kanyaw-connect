<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Expects the `presence_status` attribute set by PresenceService::visibleTo().
 *
 * @mixin User
 */
class PresenceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->presence_status,
            'last_seen_at' => $this->last_seen_at,
        ];
    }
}
