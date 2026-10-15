<?php

namespace App\Actions\Devices;

use App\Models\Device;

class RotateSignedPrekey
{
    /**
     * @param  array{id: int, public_key: string, signature: string}  $data  validated request
     */
    public function handle(Device $device, array $data): Device
    {
        $device->update([
            'signed_prekey_id' => $data['id'],
            'signed_prekey_public' => $data['public_key'],
            'signed_prekey_signature' => $data['signature'],
            'signed_prekey_rotated_at' => now(),
        ]);

        return $device;
    }
}
