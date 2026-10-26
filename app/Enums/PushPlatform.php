<?php

namespace App\Enums;

/** Which push service reaches a phone: FCM for Android, APNs for iOS. */
enum PushPlatform: string
{
    case Android = 'android';
    case Ios = 'ios';
}
