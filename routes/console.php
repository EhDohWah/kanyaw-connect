<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Users whose heartbeat has expired become offline. Needs `php artisan schedule:work` (or a cron entry).
Schedule::command('presence:mark-offline')->everyMinute()->withoutOverlapping();
