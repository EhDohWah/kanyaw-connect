<?php

namespace App\Services;

use App\Enums\RoomRole;
use App\Events\RoomAdmitted;
use App\Events\RoomBroadcastEvent;
use App\Events\RoomDenied;
use App\Events\RoomEnded;
use App\Events\RoomJoinRequested;
use App\Events\RoomParticipantJoined;
use App\Events\RoomParticipantLeft;
use App\Events\RoomRoleChanged;
use App\Http\Resources\PublicUserResource;
use App\Http\Resources\RoomSummaryResource;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Turns room changes into broadcast events. Callers invoke it after their transaction commits.
 *
 * Room-wide events go to presence-room.{id}, which only admitted participants may join.
 * Waiting users are not on that channel, so what concerns them goes to their private-user channel.
 */
class RoomBroadcaster
{
    public function participantJoined(Room $room, User $user, RoomRole $role): void
    {
        $this->send(RoomParticipantJoined::class, $room, [
            'room_id' => $room->getKey(),
            'user' => $this->resolve(new PublicUserResource($user)),
            'role' => $role->value,
        ]);
    }

    public function participantLeft(Room $room, User $user, RoomRole $role): void
    {
        $this->send(RoomParticipantLeft::class, $room, [
            'room_id' => $room->getKey(),
            'user' => $this->resolve(new PublicUserResource($user)),
            'role' => $role->value,
        ]);
    }

    /** Tell the host and co-hosts that someone is waiting to be let in. */
    public function joinRequested(Room $room, User $user): void
    {
        $managerIds = RoomParticipant::where('room_id', $room->getKey())
            ->whereIn('role', [RoomRole::Host->value, RoomRole::CoHost->value])
            ->where('admission', 'admitted')
            ->pluck('user_id')
            ->all();

        $this->send(RoomJoinRequested::class, $room, [
            'room_id' => $room->getKey(),
            'user' => $this->resolve(new PublicUserResource($user)),
        ], $managerIds);
    }

    /** The waiting user hears this on their user channel and can then call join again. */
    public function admitted(Room $room, User $user): void
    {
        $this->send(RoomAdmitted::class, $room, ['room' => $this->resolve(new RoomSummaryResource($room))], [$user->getKey()], toRoom: false);
    }

    public function denied(Room $room, User $user): void
    {
        $this->send(RoomDenied::class, $room, ['room' => $this->resolve(new RoomSummaryResource($room))], [$user->getKey()], toRoom: false);
    }

    public function ended(Room $room): void
    {
        $this->send(RoomEnded::class, $room, [
            'room_id' => $room->getKey(),
            'ended_at' => $room->ended_at,
        ]);
    }

    /** Also used when the host role moves to someone else (host_id then names the new host). */
    public function roleChanged(Room $room, string $userId, RoomRole $role): void
    {
        $this->send(RoomRoleChanged::class, $room, [
            'room_id' => $room->getKey(),
            'user_id' => $userId,
            'role' => $role->value,
            'host_id' => $room->host_id,
        ]);
    }

    /**
     * @param  class-string<RoomBroadcastEvent>  $event
     * @param  array<string, mixed>  $payload
     * @param  list<string>  $userIds
     */
    private function send(string $event, Room $room, array $payload, array $userIds = [], bool $toRoom = true): void
    {
        event(new $event($room->getKey(), $payload, $userIds, $toRoom));
    }

    /**
     * Plain JSON data, resolved against an anonymous request (see ChatBroadcaster::resolve).
     */
    private function resolve(JsonResource $resource): object
    {
        return json_decode(json_encode($resource->resolve(Request::create('/'))));
    }
}
