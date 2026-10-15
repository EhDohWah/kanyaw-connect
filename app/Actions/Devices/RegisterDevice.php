<?php

namespace App\Actions\Devices;

use App\Models\Device;
use App\Models\OneTimePrekey;
use App\Models\User;
use App\Services\DeviceBroadcaster;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class RegisterDevice
{
    public function __construct(private DeviceBroadcaster $broadcaster) {}

    /**
     * Register a device from its public keys. The count of active devices is checked under a lock on
     * the user's row, so two registrations at once cannot both slip past the limit.
     *
     * @param  array<string, mixed>  $data  validated request
     *
     * @throws ValidationException when the user already has the maximum number of active devices
     */
    public function handle(User $user, array $data): Device
    {
        $device = DB::transaction(function () use ($user, $data) {
            User::whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            if ($user->devices()->active()->count() >= config('e2ee.max_devices_per_user')) {
                throw ValidationException::withMessages([
                    'device' => ['You already have '.config('e2ee.max_devices_per_user').' devices. Remove one before adding another.'],
                ]);
            }

            $device = $user->devices()->create([
                'name' => $data['name'],
                'identity_public_key' => $data['identity_public_key'],
                'exchange_public_key' => $data['exchange_public_key'],
                'signed_prekey_id' => $data['signed_prekey']['id'],
                'signed_prekey_public' => $data['signed_prekey']['public_key'],
                'signed_prekey_signature' => $data['signed_prekey']['signature'],
                'signed_prekey_rotated_at' => now(),
                'last_active_at' => now(),
            ]);

            $now = Device::microseconds(now());
            OneTimePrekey::insert(array_map(fn (array $key) => [
                'id' => (string) Str::uuid7(),
                'device_id' => $device->getKey(),
                'key_id' => $key['id'],
                'public_key' => $key['public_key'],
                'created_at' => $now,
            ], $data['one_time_prekeys']));

            return $device;
        });

        $device->setAttribute('unclaimed_prekeys_count', count($data['one_time_prekeys']));

        $this->broadcaster->added($device);

        return $device;
    }
}
