<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\UserStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Users\HeartbeatRequest;
use App\Http\Requests\Users\PresenceLookupRequest;
use App\Http\Resources\PresenceResource;
use App\Services\PresenceService;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class PresenceController extends Controller
{
    public function __construct(private PresenceService $presence) {}

    /** POST /me/heartbeat — clients call this every 30-60 seconds while the app is open. */
    public function heartbeat(HeartbeatRequest $request): Response
    {
        $status = $request->validated('status');

        $this->presence->heartbeat($request->user(), $status ? UserStatus::from($status) : null);

        return response()->noContent();
    }

    /** GET /users/presence?ids[]= */
    public function index(PresenceLookupRequest $request): AnonymousResourceCollection
    {
        return PresenceResource::collection($this->presence->visibleTo($request->user(), $request->validated('ids')));
    }
}
