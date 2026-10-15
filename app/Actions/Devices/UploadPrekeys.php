<?php

namespace App\Actions\Devices;

use App\Models\Device;
use App\Models\OneTimePrekey;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class UploadPrekeys
{
    /**
     * Add one-time prekeys to a device. The server holds a bounded number of unclaimed ones per
     * device, checked under a lock on the device so concurrent top-ups cannot exceed it.
     *
     * @param  list<array{id: int, public_key: string}>  $prekeys
     * @return int how many unclaimed prekeys the device has now
     *
     * @throws ValidationException when the pool would exceed its limit
     */
    public function handle(Device $device, array $prekeys): int
    {
        return DB::transaction(function () use ($device, $prekeys) {
            Device::whereKey($device->getKey())->lockForUpdate()->firstOrFail();

            $unclaimed = $device->unclaimedPrekeyCount();
            $room = config('e2ee.prekeys.pool_max') - $unclaimed;

            if (count($prekeys) > $room) {
                throw ValidationException::withMessages([
                    'prekeys' => ['The server keeps at most '.config('e2ee.prekeys.pool_max')." unclaimed prekeys per device; this device has {$unclaimed}, so you can add {$room} more."],
                ]);
            }

            $now = Device::microseconds(now());
            OneTimePrekey::insert(array_map(fn (array $key) => [
                'id' => (string) Str::uuid7(),
                'device_id' => $device->getKey(),
                'key_id' => $key['id'],
                'public_key' => $key['public_key'],
                'created_at' => $now,
            ], $prekeys));

            return $unclaimed + count($prekeys);
        });
    }
}
