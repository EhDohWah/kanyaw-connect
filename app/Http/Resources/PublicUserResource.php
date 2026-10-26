<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What other people may see about a user. Never add email, phone or settings here.
 *
 * @mixin User
 */
class PublicUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'avatar_url' => $this->avatar_url,
            'avatar_thumb_url' => $this->avatar_thumb_url,
            // Only present (true) for a deleted account, whose name is then "Deleted user" (see DeleteAccount).
            'is_deleted' => $this->when($this->resource->trashed(), true),
        ];
    }
}
