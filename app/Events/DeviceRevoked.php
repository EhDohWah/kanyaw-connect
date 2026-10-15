<?php

namespace App\Events;

class DeviceRevoked extends DeviceBroadcastEvent
{
    public function broadcastAs(): string
    {
        return 'device.revoked';
    }
}
