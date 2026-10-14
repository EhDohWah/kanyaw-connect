<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Rooms\HandleLiveKitWebhook;
use App\Http\Controllers\Controller;
use App\Services\LiveKitService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

/**
 * Receives events from the LiveKit server. Not authenticated with a bearer token: the request is
 * trusted only if its signature, expiry and body checksum verify against our LiveKit secret.
 */
class LiveKitWebhookController extends Controller
{
    public function __invoke(Request $request, LiveKitService $livekit, HandleLiveKitWebhook $handler): JsonResponse
    {
        try {
            $event = $livekit->receiveWebhook($request->getContent(), $request->header('Authorization'));
        } catch (Throwable) {
            return response()->json(['message' => 'Invalid webhook signature.'], 401);
        }

        $handler->handle($event);

        return response()->json(['message' => 'ok']);
    }
}
