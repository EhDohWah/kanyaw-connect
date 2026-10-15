<?php

namespace App\Http\Resources;

use App\Models\PushSubscription;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin PushSubscription
 */
class PushSubscriptionResource extends JsonResource
{
    /**
     * The keys are never returned. The endpoint is, so a browser can tell which entry is its own
     * (compare with `registration.pushManager.getSubscription().endpoint`).
     *
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'endpoint' => $this->endpoint,
            'created_at' => $this->created_at,
        ];
    }
}
