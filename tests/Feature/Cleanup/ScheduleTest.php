<?php

use Illuminate\Console\Scheduling\Event as ScheduledEvent;
use Illuminate\Console\Scheduling\Schedule;

/** The scheduled event for an artisan command, found by its text. */
function scheduled(string $command): ScheduledEvent
{
    $found = collect(app(Schedule::class)->events())->first(fn (ScheduledEvent $e) => str_contains($e->command, " {$command}"));

    expect($found)->not->toBeNull("{$command} is not scheduled");

    return $found;
}

it('schedules every housekeeping command', function (string $command, string $expression) {
    expect(scheduled($command)->expression)->toBe($expression);
})->with([
    'presence' => ['presence:mark-offline', '* * * * *'],
    'stale rooms every 15 minutes' => ['rooms:end-stale', '*/15 * * * *'],
    'orphan uploads hourly' => ['attachments:purge-orphans', '0 * * * *'],
    'deleted messages daily at 03:10' => ['messages:purge-deleted', '10 3 * * *'],
    'expired tokens daily at 03:30' => ['sanctum:prune-expired --hours=24', '30 3 * * *'],
    'old failed jobs daily at 03:40' => ['queue:prune-failed --hours=168', '40 3 * * *'],
]);

it('runs the daily jobs in the quiet hours of Thailand, not UTC', function (string $command) {
    expect(scheduled($command)->timezone)->toBe('Asia/Bangkok');
})->with(['messages:purge-deleted', 'sanctum:prune-expired --hours=24', 'queue:prune-failed --hours=168']);

it('never lets a slow run overlap the next one, and runs on one server only', function (string $command) {
    $event = scheduled($command);

    expect($event->withoutOverlapping)->toBeTrue()->and($event->onOneServer)->toBeTrue();
})->with(['rooms:end-stale', 'attachments:purge-orphans', 'messages:purge-deleted']);

it('lists them all in schedule:list', function () {
    $this->artisan('schedule:list')
        ->expectsOutputToContain('rooms:end-stale')
        ->expectsOutputToContain('messages:purge-deleted')
        ->expectsOutputToContain('attachments:purge-orphans')
        ->assertSuccessful();
});

it('points at commands that exist', function () {
    foreach (app(Schedule::class)->events() as $event) {
        $name = explode(' ', trim(explode("'artisan'", $event->command)[1] ?? ''))[0];

        expect(array_key_exists($name, Artisan::all()))->toBeTrue("{$name} is not an artisan command");
    }
});
