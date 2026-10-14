<?php

namespace App\Enums;

enum ChatRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Member = 'member';
}
