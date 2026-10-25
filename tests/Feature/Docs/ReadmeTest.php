<?php

use Illuminate\Console\Scheduling\Event as ScheduledEvent;
use Illuminate\Console\Scheduling\Schedule;

/*
| The README is how someone sets the server up. These tests keep it complete: every setting the
| application's own config files read from the environment must be explained, every scheduled job
| mentioned, and every link must work.
*/

function readme(): string
{
    return file_get_contents(dirname(__DIR__, 3).'/README.md');
}

/** Environment variables read by the config files this project wrote (not Laravel's own defaults). */
function projectEnvKeys(): array
{
    $keys = [];

    foreach (['cors', 'e2ee', 'push', 'cleanup', 'security', 'rooms', 'calls', 'chat', 'sanctum', 'account'] as $file) {
        preg_match_all("/env\('([A-Z0-9_]+)'/", file_get_contents(dirname(__DIR__, 3)."/config/{$file}.php"), $m);
        array_push($keys, ...$m[1]);
    }

    // LiveKit's block in config/services.php (the rest of that file belongs to Laravel's mail services).
    preg_match("/'livekit' => \[(.*?)\n    \],/s", file_get_contents(dirname(__DIR__, 3).'/config/services.php'), $block);
    preg_match_all("/env\('([A-Z0-9_]+)'/", $block[1] ?? '', $m);
    array_push($keys, ...$m[1]);

    // The Reverb settings the project documents.
    array_push($keys, 'REVERB_APP_ID', 'REVERB_APP_KEY', 'REVERB_APP_SECRET', 'REVERB_HOST', 'REVERB_PORT', 'REVERB_SCHEME', 'REVERB_SERVER_HOST', 'REVERB_SERVER_PORT', 'REVERB_ALLOWED_ORIGINS', 'REVERB_MAX_REQUEST_SIZE');

    return array_values(array_unique($keys));
}

it('explains every setting of the project in the README', function () {
    $missing = array_values(array_filter(projectEnvKeys(), fn ($key) => ! str_contains(readme(), "`{$key}`")));

    expect(projectEnvKeys())->toContain('VAPID_PUBLIC_KEY', 'CORS_ALLOWED_ORIGINS', 'LIVEKIT_API_SECRET', 'SANCTUM_TOKEN_EXPIRATION')
        ->and($missing)->toBe([]);
});

it('lists every setting of the project in .env.example', function () {
    $example = file_get_contents(dirname(__DIR__, 3).'/.env.example');

    $missing = array_values(array_filter(projectEnvKeys(), fn ($key) => ! preg_match('/^#?\s*'.$key.'=/m', $example)));

    expect($missing)->toBe([]);
});

it('mentions every scheduled job and the VAPID command', function () {
    $commands = collect(app(Schedule::class)->events())
        ->map(fn (ScheduledEvent $e) => explode(' ', trim(explode("'artisan'", $e->command)[1]))[0])
        ->unique()
        ->all();

    $missing = array_values(array_filter([...$commands, 'push:vapid'], fn ($command) => ! str_contains(readme(), $command)));

    expect($commands)->not->toBeEmpty()->and($missing)->toBe([]);
});

it('carries the note for frontend developers about end-to-end encryption', function () {
    expect(readme())->toContain('vetted protocol')->toContain('Double Ratchet')->toContain('Ed25519')->toContain('X25519')->toContain('crypto_box');
});

it('links only to files and headings that exist', function () {
    $readme = readme();
    $root = dirname(__DIR__, 3);
    $text = preg_replace('/```.*?```/s', '', $readme);

    preg_match_all('/^#{1,6} (.+)$/m', $text, $headings);
    $anchors = array_map(fn ($h) => str_replace(' ', '-', preg_replace('/[^a-z0-9 _-]/', '', mb_strtolower($h))), $headings[1]);

    preg_match_all('/\]\(([^)\s]+)\)/', $text, $links);

    $broken = [];
    foreach ($links[1] as $link) {
        if (str_starts_with($link, 'http')) {
            continue;
        }

        [$path, $anchor] = array_pad(explode('#', $link, 2), 2, null);

        if ($path !== '' && ! file_exists("{$root}/{$path}")) {
            $broken[] = $link;
        } elseif ($path === '' && ! in_array($anchor, $anchors, true)) {
            $broken[] = $link;
        } elseif ($path !== '' && $anchor !== null) {
            $target = file_get_contents("{$root}/{$path}");
            preg_match_all('/^#{1,6} (.+)$/m', preg_replace('/```.*?```/s', '', $target), $h);
            $targetAnchors = array_map(fn ($x) => str_replace(' ', '-', preg_replace('/[^a-z0-9 _-]/', '', mb_strtolower($x))), $h[1]);

            if (! in_array($anchor, $targetAnchors, true)) {
                $broken[] = $link;
            }
        }
    }

    expect($links[1])->not->toBeEmpty()->and($broken)->toBe([]);
});

it('does not claim a state it is not in', function () {
    expect(readme())->not->toContain('Phase 1')->not->toContain('Phase 5')->not->toContain('Phase 6')->not->toContain('is written in Phase');
});
