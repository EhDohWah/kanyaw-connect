<?php

namespace App\Actions\Devices;

use App\Models\Device;
use App\Services\DeviceBroadcaster;
use Illuminate\Support\Facades\DB;

class RevokeDevice
{
    public function __construct(private DeviceBroadcaster $broadcaster) {}

    /**
     * Revoke a device: it stops appearing in key bundles and device lists, senders must no longer
     * encrypt for it, it can no longer read envelopes, and its unclaimed prekeys are deleted.
     * Messages already encrypted for it stay as they are.
     */
    public function handle(Device $device): void
    {
        DB::transaction(function () use ($device) {
            $device->update(['revoked_at' => now()]);
            $device->oneTimePrekeys()->whereNull('claimed_at')->delete();
        });

        $this->broadcaster->revoked($device);
    }
}
