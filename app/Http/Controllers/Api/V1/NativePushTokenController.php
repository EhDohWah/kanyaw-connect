<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Push\StoreNativePushToken;
use App\Http\Controllers\Controller;
use App\Http\Requests\Push\StoreNativePushTokenRequest;
use App\Http\Resources\NativePushTokenResource;
use App\Models\NativePushToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

class NativePushTokenController extends Controller
{
    public function store(StoreNativePushTokenRequest $request, StoreNativePushToken $action): JsonResponse
    {
        [$registration, $created] = $action->handle($request->user(), $request->user()->currentAccessToken(), $request->validated());

        return (new NativePushTokenResource($registration))->response()->setStatusCode($created ? 201 : 200);
    }

    public function destroy(NativePushToken $token): Response
    {
        $token->delete();

        return response()->noContent();
    }
}
