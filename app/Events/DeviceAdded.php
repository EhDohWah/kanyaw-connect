<?php

namespace App\Events;

class DeviceAdded extends DeviceBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'device.added';
    }
}
