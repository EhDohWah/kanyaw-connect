<?php

namespace App\Services;

use App\Models\Device;
use App\Models\OneTimePrekey;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class KeyBundleService
{
    /**
     * A key bundle for each active device of $target, claiming one one-time prekey per device.
     *
     * A claim is atomic and exclusive: the prekey row is selected with FOR UPDATE SKIP LOCKED and
     * marked claimed in the same transaction. Two requests at the same moment therefore can never get
     * the same prekey: the second skips the row the first is holding and takes the next one (or none).
     * All devices are claimed in one transaction, so a failure part-way claims nothing.
     *
     * A device with no unclaimed prekeys is still returned, with no one-time prekey; the sender can
     * start a session with its signed prekey alone.
     *
     * @param  ?Device  $claimer  the requesting device, recorded on each claimed prekey; and excluded from the
     *                            result when you are fetching your own bundles (you do not need yours)
     * @param  list<string>|null  $onlyDeviceIds  restrict to these devices (to avoid claiming prekeys you do not need)
     * @return Collection<int, Device> each with a `claimedPrekey` relation (possibly null)
     */
    public function claimFor(User $target, ?Device $claimer = null, ?array $onlyDeviceIds = null): Collection
    {
        return DB::transaction(function () use ($target, $claimer, $onlyDeviceIds) {
            $devices = Device::active()
                ->where('user_id', $target->getKey())
                ->when($claimer && $claimer->user_id === $target->getKey(), fn ($q) => $q->where('devices.id', '!=', $claimer->getKey()))
                ->when($onlyDeviceIds !== null, fn ($q) => $q->whereIn('devices.id', $onlyDeviceIds))
                ->orderBy('devices.created_at')
                ->orderBy('devices.id')
                ->get();

            foreach ($devices as $device) {
                $prekey = OneTimePrekey::where('device_id', $device->getKey())
                    ->whereNull('claimed_at')
                    ->orderBy('key_id')
                    ->lock('for update skip locked')
                    ->first();

                $prekey?->update([
                    'claimed_at' => OneTimePrekey::microseconds(now()),
                    'claimed_by_device_id' => $claimer?->getKey(),
                ]);

                $device->setRelation('claimedPrekey', $prekey);
            }

            return $devices;
        });
    }
}
