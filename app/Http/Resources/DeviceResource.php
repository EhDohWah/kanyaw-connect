<?php

namespace App\Http\Resources;

use App\Models\Device;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A device as its owner sees it. Public keys only.
 *
 * @mixin Device
 */
class DeviceResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'identity_public_key' => $this->identity_public_key,
            'exchange_public_key' => $this->exchange_public_key,
            'signed_prekey' => [
                'id' => $this->signed_prekey_id,
                'public_key' => $this->signed_prekey_public,
                'signature' => $this->signed_prekey_signature,
                'rotated_at' => $this->signed_prekey_rotated_at,
            ],
            // Present when loaded with withCount / set by the action.
            'unclaimed_prekeys' => $this->when(
                array_key_exists('unclaimed_prekeys_count', $this->getAttributes()),
                fn () => (int) $this->unclaimed_prekeys_count,
            ),
            'last_active_at' => $this->last_active_at,
            'created_at' => $this->created_at,
        ];
    }
}
