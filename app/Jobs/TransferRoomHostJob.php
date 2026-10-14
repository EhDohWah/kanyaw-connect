<?php

namespace App\Jobs;

use App\Actions\Rooms\TransferRoomHost;
use App\Models\Room;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * Hands the host role on after a grace period (rooms.host_transfer_grace_seconds), unless the
 * host has come back in the meantime. Carries ids only, so a deleted room is simply skipped.
 */
class TransferRoomHostJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public function __construct(public string $roomId, public string $previousHostId) {}

    public function handle(TransferRoomHost $transfer): void
    {
        $room = Room::find($this->roomId);

        if ($room) {
            $transfer->handle($room, $this->previousHostId);
        }
    }
}
