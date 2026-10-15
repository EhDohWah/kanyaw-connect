<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Push\StorePushSubscription;
use App\Http\Controllers\Controller;
use App\Http\Requests\Push\StorePushSubscriptionRequest;
use App\Http\Resources\PushSubscriptionResource;
use App\Models\PushSubscription;
use App\Services\WebPushService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class PushSubscriptionController extends Controller
{
    /** What the browser needs to subscribe, or `enabled: false` when the server has no VAPID keys. */
    public function publicKey(WebPushService $push): JsonResponse
    {
        return response()->json(['data' => [
            'enabled' => $push->isConfigured(),
            'public_key' => $push->publicKey(),
        ]]);
    }

    /** The user's subscriptions, oldest first. Not paginated: a user can have at most 20. */
    public function index(Request $request): AnonymousResourceCollection
    {
        return PushSubscriptionResource::collection(
            $request->user()->pushSubscriptions()->orderBy('created_at')->orderBy('id')->get()
        );
    }

    public function store(StorePushSubscriptionRequest $request, StorePushSubscription $action): JsonResponse
    {
        [$subscription, $created] = $action->handle($request->user(), $request->validated());

        return (new PushSubscriptionResource($subscription))->response()->setStatusCode($created ? 201 : 200);
    }

    public function destroy(PushSubscription $subscription): Response
    {
        $subscription->delete();

        return response()->noContent();
    }
}
