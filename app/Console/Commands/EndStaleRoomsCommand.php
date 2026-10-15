<?php

namespace App\Console\Commands;

use App\Actions\Rooms\EndStaleRooms;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('rooms:end-stale')]
#[Description('End video rooms that were left behind (never started, or abandoned without LiveKit telling us)')]
class EndStaleRoomsCommand extends Command
{
    public function handle(EndStaleRooms $action): int
    {
        $result = $action->handle();

        $this->info("Ended {$result['never_started']} room(s) nobody joined, {$result['empty']} empty and {$result['too_long']} running too long.");

        if ($result['failed'] > 0) {
            $this->warn("{$result['failed']} room(s) could not be closed because LiveKit is unavailable; they will be retried.");
        }

        return self::SUCCESS;
    }
}
