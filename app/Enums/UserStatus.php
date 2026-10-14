<?php

namespace App\Enums;

enum UserStatus: string
{
    case Online = 'online';
    case Offline = 'offline';
    case Away = 'away';
    case Busy = 'busy';
}
