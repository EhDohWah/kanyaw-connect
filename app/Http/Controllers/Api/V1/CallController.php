<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Calls\AcceptCall;
use App\Actions\Calls\CancelCall;
use App\Actions\Calls\DeclineCall;
use App\Actions\Calls\EndCall;
use App\Actions\Calls\ExpireRingingCalls;
use App\Actions\Calls\StartCall;
use App\Enums\CallKind;
use App\Http\Controllers\Controller;
use App\Http\Requests\Calls\StartCallRequest;
use App\Http\Resources\CallResource;
use App\Models\Call;
use App\Models\Chat;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Exceptions\InvalidSignatureException;
use Illuminate\Support\Facades\Gate;

class CallController extends Controller
{
    public function store(StartCallRequest $request, Chat $chat, StartCall $action): JsonResponse
    {
        $call = $action->handle($chat, $request->user(), CallKind::from($request->validated('kind')));

        return CallResource::for($call)->response()->setStatusCode(201);
    }

    /** The signed-in user's ringing or ongoing call, or null. Asked on app start and after every reconnect. */
    public function current(Request $request, ExpireRingingCalls $expire): JsonResponse
    {
        $user = $request->user();
        $expire->handle([$user->getKey()]); // so a call that rang out is not shown as still ringing

        $call = Call::active()->involving($user)->latest()->first();

        return response()->json(['data' => $call ? CallResource::for($call)->resolve($request) : null]);
    }

    public function show(Call $call): CallResource
    {
        return CallResource::for($call);
    }

    public function accept(Call $call, AcceptCall $action): CallResource
    {
        return CallResource::for($action->handle($call));
    }

    /**
     * Decline, from the app (bearer token) or from the service worker, which has no token and uses
     * the signed decline_url from the incoming-call push instead. The signature expires with the
     * ringing and stands for the callee.
     */
    public function decline(Request $request, Call $call, DeclineCall $action): CallResource
    {
        if ($request->has('signature')) {
            if (! $request->hasValidSignature()) {
                throw new InvalidSignatureException;
            }
        } else {
            $user = auth('sanctum')->user() ?? throw new AuthenticationException;
            Gate::forUser($user)->authorize('answer', $call);
        }

        return CallResource::for($action->handle($call));
    }

    public function cancel(Call $call, CancelCall $action): CallResource
    {
        return CallResource::for($action->handle($call));
    }

    public function end(Call $call, EndCall $action): CallResource
    {
        return CallResource::for($action->handle($call));
    }
}
