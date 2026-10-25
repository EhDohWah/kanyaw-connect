<?php

namespace App\Enums;

enum CallKind: string
{
    case Voice = 'voice';
    case Video = 'video';
}
