<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Users whose heartbeat has expired become offline. Needs `php artisan schedule:work` (or a cron entry).
Schedule::command('presence:mark-offline')->everyMinute()->withoutOverlapping();

// Housekeeping. Quiet hours in Thailand (the community's time zone), so heavy deletes do not compete with chats.
Schedule::command('rooms:end-stale')->everyFifteenMinutes()->withoutOverlapping()->onOneServer();
Schedule::command('attachments:purge-orphans')->hourly()->withoutOverlapping()->onOneServer();
Schedule::command('messages:purge-deleted')->timezone('Asia/Bangkok')->dailyAt('03:10')->withoutOverlapping()->onOneServer();
Schedule::command('sanctum:prune-expired --hours=24')->timezone('Asia/Bangkok')->dailyAt('03:30')->onOneServer();
Schedule::command('auth:clear-resets')->timezone('Asia/Bangkok')->dailyAt('03:35')->onOneServer();
Schedule::command('queue:prune-failed --hours=168')->timezone('Asia/Bangkok')->dailyAt('03:40')->onOneServer();
