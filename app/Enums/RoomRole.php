<?php

namespace App\Enums;

enum RoomRole: string
{
    case Host = 'host';
    case CoHost = 'co_host';
    case Participant = 'participant';
}
