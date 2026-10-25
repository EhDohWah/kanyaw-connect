<?php

namespace App\Console\Commands;

use App\Actions\Calls\EndStaleCalls;
use App\Actions\Rooms\EndStaleRooms;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('rooms:end-stale')]
#[Description('End video rooms and calls that were left behind (never started, rang out, or abandoned without LiveKit telling us)')]
class EndStaleRoomsCommand extends Command
{
    public function handle(EndStaleCalls $calls, EndStaleRooms $action): int
    {
        // Calls first: ending a call also ends its room.
        $ended = $calls->handle();
        $this->info("Ended {$ended['missed']} call(s) that rang out unanswered and {$ended['lost']} whose connection was lost.");

        $result = $action->handle();

        $this->info("Ended {$result['never_started']} room(s) nobody joined, {$result['empty']} empty and {$result['too_long']} running too long.");

        if ($result['failed'] > 0) {
            $this->warn("{$result['failed']} room(s) could not be closed because LiveKit is unavailable; they will be retried.");
        }

        return self::SUCCESS;
    }
}
