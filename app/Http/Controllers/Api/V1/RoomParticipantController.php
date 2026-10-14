<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Rooms\MuteRoomParticipant;
use App\Actions\Rooms\PromoteCoHost;
use App\Actions\Rooms\RemoveRoomParticipant;
use App\Actions\Rooms\ReviewJoinRequest;
use App\Http\Controllers\Controller;
use App\Http\Requests\Rooms\MuteParticipantRequest;
use App\Http\Resources\RoomParticipantResource;
use App\Models\Room;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * Host and co-host controls. Who may call each is decided by RoomPolicy through route middleware.
 */
class RoomParticipantController extends Controller
{
    public function admit(Room $room, User $user, ReviewJoinRequest $action): RoomParticipantResource
    {
        return new RoomParticipantResource($action->admit($room, $user)->load('user'));
    }

    public function deny(Room $room, User $user, ReviewJoinRequest $action): RoomParticipantResource
    {
        return new RoomParticipantResource($action->deny($room, $user)->load('user'));
    }

    public function remove(Room $room, User $user, RemoveRoomParticipant $action): Response
    {
        $action->handle($room, $user);

        return response()->noContent();
    }

    public function mute(MuteParticipantRequest $request, Room $room, User $user, MuteRoomParticipant $action): JsonResponse
    {
        $muted = $action->handle($room, $user, $request->validated('kind') ?? 'audio');

        return response()->json(['data' => ['muted_tracks' => $muted]]);
    }

    public function coHost(Room $room, User $user, PromoteCoHost $action): RoomParticipantResource
    {
        return new RoomParticipantResource($action->handle($room, $user)->load('user'));
    }
}
