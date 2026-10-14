<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Users\StoreAvatar;
use App\Actions\Users\UpdateProfile;
use App\Http\Controllers\Controller;
use App\Http\Requests\Users\UpdateAvatarRequest;
use App\Http\Requests\Users\UpdateProfileRequest;
use App\Http\Resources\UserResource;
use Illuminate\Http\Request;

class MeController extends Controller
{
    public function show(Request $request): UserResource
    {
        return new UserResource($request->user());
    }

    public function update(UpdateProfileRequest $request, UpdateProfile $action): UserResource
    {
        return new UserResource($action->handle($request->user(), $request->validated()));
    }

    public function avatar(UpdateAvatarRequest $request, StoreAvatar $action): UserResource
    {
        return new UserResource($action->handle($request->user(), $request->file('avatar')));
    }
}
