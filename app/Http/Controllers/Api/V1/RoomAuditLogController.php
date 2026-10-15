<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\RoomAuditLogResource;
use App\Models\Room;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class RoomAuditLogController extends Controller
{
    /**
     * What the host and co-hosts did in this room, newest first. Only the host may read it (route
     * middleware `can:host,room`).
     */
    public function index(Request $request, Room $room): AnonymousResourceCollection
    {
        $entries = $room->auditLogs()
            ->with(['actor', 'target'])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($this->perPage($request))
            ->withQueryString();

        return RoomAuditLogResource::collection($entries);
    }
}
