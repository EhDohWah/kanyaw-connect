<?php

namespace App\Http\Resources;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The authenticated user's own profile. Contains private fields (email, phone, settings),
 * so it must never be used to show *other* users.
 *
 * @mixin User
 */
class UserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'email_verified_at' => $this->email_verified_at,
            'avatar_url' => $this->avatar_url,
            'avatar_thumb_url' => $this->avatar_thumb_url,
            'status' => $this->status,
            'last_seen_at' => $this->last_seen_at,
            'timezone' => $this->timezone,
            'locale' => $this->locale,
            // Cast to object so an empty settings bag serialises as {} rather than [].
            'settings' => (object) ($this->settings ?? []),
            'created_at' => $this->created_at,
        ];
    }
}
