<?php

namespace App\Enums;

enum RoomAdmission: string
{
    case Admitted = 'admitted';
    case Waiting = 'waiting';
    case Denied = 'denied';
}
