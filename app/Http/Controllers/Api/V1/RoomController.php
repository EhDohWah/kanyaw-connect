<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Rooms\CreateRoom;
use App\Actions\Rooms\JoinRoom;
use App\Http\Controllers\Controller;
use App\Http\Requests\Rooms\JoinRoomRequest;
use App\Http\Requests\Rooms\ListRoomsRequest;
use App\Http\Requests\Rooms\StoreRoomRequest;
use App\Http\Resources\RoomResource;
use App\Models\Room;
use App\Services\LiveKitService;
use App\Services\RoomQueryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class RoomController extends Controller
{
    public function __construct(private RoomQueryService $rooms) {}

    public function index(ListRoomsRequest $request): AnonymousResourceCollection
    {
        return RoomResource::collection(
            $this->rooms->paginate($request->user(), $request->validated('filter'), $this->perPage($request))
        );
    }

    public function store(StoreRoomRequest $request, CreateRoom $action): JsonResponse
    {
        $room = $action->handle($request->user(), $request->validated());

        return (new RoomResource($this->rooms->find($request->user(), $room)))->response()->setStatusCode(201);
    }

    public function show(Request $request, Room $room): RoomResource
    {
        return new RoomResource($this->rooms->find($request->user(), $room));
    }

    /**
     * Admitted: a LiveKit token and the address to connect to.
     * Waiting: the host has to let the person in; they hear about it on their user channel
     * (room.admitted / room.denied) and then call this again.
     */
    public function join(JoinRoomRequest $request, Room $room, JoinRoom $action, LiveKitService $livekit): JsonResponse
    {
        $result = $action->handle($room, $request->user());

        if ($result['status'] === 'waiting') {
            return response()->json(['status' => 'waiting']);
        }

        return response()->json([
            'status' => 'admitted',
            'token' => $result['token'],
            'livekit_url' => $livekit->clientUrl(),
            'room' => (new RoomResource($this->rooms->find($request->user(), $room)))->resolve($request),
        ]);
    }
}
