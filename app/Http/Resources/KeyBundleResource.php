<?php

namespace App\Http\Resources;

use App\Models\Device;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a sender needs to start an encrypted session with one device. The one-time prekey is the one
 * claimed for this request (relation `claimedPrekey`), or null when the device has none left.
 * Contains no device name.
 *
 * @mixin Device
 */
class KeyBundleResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $prekey = $this->relationLoaded('claimedPrekey') ? $this->claimedPrekey : null;

        return [
            'device_id' => $this->id,
            'user_id' => $this->user_id,
            'identity_public_key' => $this->identity_public_key,
            'exchange_public_key' => $this->exchange_public_key,
            'signed_prekey' => [
                'id' => $this->signed_prekey_id,
                'public_key' => $this->signed_prekey_public,
                'signature' => $this->signed_prekey_signature,
            ],
            'one_time_prekey' => $prekey ? ['id' => $prekey->key_id, 'public_key' => $prekey->public_key] : null,
        ];
    }
}
