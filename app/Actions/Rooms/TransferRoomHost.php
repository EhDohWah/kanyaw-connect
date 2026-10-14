<?php

namespace App\Actions\Rooms;

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Enums\RoomStatus;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Services\RoomBroadcaster;
use Illuminate\Support\Facades\DB;

class TransferRoomHost
{
    public function __construct(private RoomBroadcaster $broadcaster) {}

    /**
     * After the host has left, hand the host role to the earliest-joined co-host who is connected,
     * otherwise to the earliest-joined connected participant. Does nothing if nobody is left, if the
     * room is over, or if the host has since come back or the role has already moved on.
     */
    public function handle(Room $room, string $previousHostId): void
    {
        $newHost = DB::transaction(function () use ($room, $previousHostId) {
            $locked = Room::whereKey($room->getKey())->lockForUpdate()->firstOrFail();

            if ($locked->status === RoomStatus::Ended || $locked->host_id !== $previousHostId) {
                return null;
            }

            $previous = $locked->participants()->where('user_id', $previousHostId)->first();

            if ($previous?->isPresent()) {
                return null; // reconnected
            }

            /** @var RoomParticipant|null $successor */
            $successor = $locked->participants()
                ->where('admission', RoomAdmission::Admitted->value)
                ->where('user_id', '!=', $previousHostId)
                ->whereNotNull('joined_at')->whereNull('left_at')
                ->orderByRaw("case role when 'co_host' then 0 else 1 end")
                ->orderBy('joined_at')
                ->orderBy('id')
                ->lockForUpdate()
                ->first();

            if (! $successor) {
                return null;
            }

            $previous?->update(['role' => RoomRole::Participant]);
            $successor->update(['role' => RoomRole::Host]);
            $locked->update(['host_id' => $successor->user_id]);

            $room->setRawAttributes($locked->getAttributes(), true);

            return $successor;
        });

        if ($newHost) {
            $this->broadcaster->roleChanged($room, $newHost->user_id, RoomRole::Host);
        }
    }
}
