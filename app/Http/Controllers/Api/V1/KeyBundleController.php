<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Devices\KeyBundlesRequest;
use App\Http\Resources\KeyBundleResource;
use App\Models\User;
use App\Services\DeviceResolver;
use App\Services\KeyBundleService;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class KeyBundleController extends Controller
{
    /**
     * Key bundles for each active device of a user, each with one freshly claimed one-time prekey.
     * Every call uses up prekeys, which is why it is rate limited and limited to people you share a chat with.
     */
    public function index(KeyBundlesRequest $request, User $user, KeyBundleService $bundles, DeviceResolver $resolver): AnonymousResourceCollection
    {
        $claimer = $resolver->optional($request);

        return KeyBundleResource::collection($bundles->claimFor($user, $claimer, $request->validated('device_ids')));
    }
}
