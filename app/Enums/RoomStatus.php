<?php

namespace App\Enums;

enum RoomStatus: string
{
    case Waiting = 'waiting';
    case Active = 'active';
    case Ended = 'ended';
}
