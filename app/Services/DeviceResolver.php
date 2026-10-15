<?php

namespace App\Services;

use App\Models\Device;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * Works out which of the user's devices a request comes from, using the X-Device-Id header.
 * The header is only trusted after checking that the device belongs to the authenticated user and
 * has not been revoked, so one user can never act as (or read envelopes for) another user's device.
 */
class DeviceResolver
{
    public const HEADER = 'X-Device-Id';

    /**
     * The calling device, or null if the request names none.
     *
     * @throws AccessDeniedHttpException when the header names a device that is not the user's active device
     */
    public function optional(Request $request): ?Device
    {
        $id = $request->header(self::HEADER);

        if ($id === null || $id === '') {
            return null;
        }

        if ($request->attributes->has('device')) {
            return $request->attributes->get('device');
        }

        $device = Str::isUuid($id)
            ? Device::active()->where('id', $id)->where('user_id', $request->user()->getKey())->first()
            : null;

        if (! $device) {
            throw new AccessDeniedHttpException('X-Device-Id must be the id of one of your active devices.');
        }

        $this->touch($device);
        $request->attributes->set('device', $device);

        return $device;
    }

    /**
     * The calling device; the header is mandatory.
     *
     * @throws ValidationException when the header is missing
     */
    public function required(Request $request): Device
    {
        return $this->optional($request) ?? throw ValidationException::withMessages([
            self::HEADER => ['The X-Device-Id header is required for encrypted chats.'],
        ]);
    }

    /** Record activity, at most once per throttle window, without touching updated_at. */
    private function touch(Device $device): void
    {
        $window = now()->subMinutes(config('e2ee.last_active_throttle_minutes'));

        if ($device->last_active_at === null || $device->last_active_at->lt($window)) {
            Device::whereKey($device->getKey())->toBase()->update(['last_active_at' => Device::microseconds(now())]);
        }
    }
}
