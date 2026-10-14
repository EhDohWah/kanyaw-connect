<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Rooms\EndRoom;
use App\Actions\Rooms\SetRoomLock;
use App\Http\Controllers\Controller;
use App\Http\Resources\RoomResource;
use App\Models\Room;
use App\Services\RoomQueryService;
use Illuminate\Http\Request;

class RoomLifecycleController extends Controller
{
    public function __construct(private RoomQueryService $rooms) {}

    public function lock(Request $request, Room $room, SetRoomLock $action): RoomResource
    {
        $action->handle($room, true);

        return new RoomResource($this->rooms->find($request->user(), $room));
    }

    public function unlock(Request $request, Room $room, SetRoomLock $action): RoomResource
    {
        $action->handle($room, false);

        return new RoomResource($this->rooms->find($request->user(), $room));
    }

    public function end(Request $request, Room $room, EndRoom $action): RoomResource
    {
        $action->handle($room);

        return new RoomResource($this->rooms->find($request->user(), $room));
    }
}
