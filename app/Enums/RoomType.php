<?php

namespace App\Enums;

enum RoomType: string
{
    case Instant = 'instant';
    case Scheduled = 'scheduled';
}
