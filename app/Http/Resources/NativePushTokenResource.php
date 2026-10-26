<?php

namespace App\Http\Resources;

use App\Models\NativePushToken;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin NativePushToken
 */
class NativePushTokenResource extends JsonResource
{
    /**
     * The push tokens themselves are never returned. The app keeps the `id` to remove its
     * registration when the person signs out.
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'platform' => $this->platform,
            'has_voip_token' => $this->voip_token !== null,
            'app_version' => $this->app_version,
            'last_seen_at' => $this->last_seen_at,
            'created_at' => $this->created_at,
        ];
    }
}
