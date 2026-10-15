<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Devices\RegisterDevice;
use App\Actions\Devices\RevokeDevice;
use App\Actions\Devices\RotateSignedPrekey;
use App\Actions\Devices\UploadPrekeys;
use App\Http\Controllers\Controller;
use App\Http\Requests\Devices\RegisterDeviceRequest;
use App\Http\Requests\Devices\RotateSignedPrekeyRequest;
use App\Http\Requests\Devices\UploadPrekeysRequest;
use App\Http\Resources\DeviceResource;
use App\Models\Device;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class DeviceController extends Controller
{
    /** The user's active devices, oldest first. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $devices = $request->user()->devices()->active()
            ->withCount(['oneTimePrekeys as unclaimed_prekeys_count' => fn ($q) => $q->whereNull('claimed_at')])
            ->orderBy('created_at')->orderBy('id')
            ->get();

        return DeviceResource::collection($devices);
    }

    public function store(RegisterDeviceRequest $request, RegisterDevice $action): JsonResponse
    {
        return (new DeviceResource($action->handle($request->user(), $request->validated())))
            ->response()
            ->setStatusCode(201);
    }

    public function destroy(Device $device, RevokeDevice $action): Response
    {
        $action->handle($device);

        return response()->noContent();
    }

    public function rotateSignedPrekey(RotateSignedPrekeyRequest $request, Device $device, RotateSignedPrekey $action): DeviceResource
    {
        return new DeviceResource($action->handle($device, $request->validated()));
    }

    public function uploadPrekeys(UploadPrekeysRequest $request, Device $device, UploadPrekeys $action): JsonResponse
    {
        $unclaimed = $action->handle($device, $request->validated('prekeys'));

        return response()->json(['data' => ['unclaimed' => $unclaimed]], 201);
    }

    public function prekeyCount(Device $device): JsonResponse
    {
        return response()->json(['data' => ['unclaimed' => $device->unclaimedPrekeyCount()]]);
    }
}
