<?php

use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

/*
| docs/API.md is the contract for the frontend. These tests keep it from drifting away from the code:
| every route and every broadcast event must be documented, nothing documented may be stale, and the
| examples and links in it must be valid.
*/

function apiDocs(): string
{
    return file_get_contents(dirname(__DIR__, 3).'/docs/API.md');
}

/** Headings like "### POST /chats/{chat}/messages" as [method, path] pairs. */
function documentedEndpoints(): array
{
    preg_match_all('~^### ((?:GET|POST|PUT|PATCH|DELETE)(?:\|(?:GET|POST|PUT|PATCH|DELETE))*) (/\S*)$~m', apiDocs(), $matches, PREG_SET_ORDER);

    return array_map(fn ($m) => [$m[1], $m[2]], $matches);
}

/** Every route the API serves, as [methods without HEAD, path without the /api/v1 prefix]. */
function servedRoutes(): array
{
    $routes = [];

    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/')) {
            continue;
        }

        $routes[] = [array_values(array_diff($route->methods(), ['HEAD'])), '/'.substr($route->uri(), strlen('api/v1/'))];
    }

    return $routes;
}

it('documents every route of the API', function () {
    $documented = array_map(fn ($d) => implode(' ', [$d[0], $d[1]]), documentedEndpoints());

    $missing = [];
    foreach (servedRoutes() as [$methods, $path]) {
        $found = collect($methods)->contains(fn ($method) => in_array("{$method} {$path}", $documented, true));

        if (! $found) {
            $missing[] = implode('|', $methods)." {$path}";
        }
    }

    expect($missing)->toBe([]);
});

it('documents no route that does not exist', function () {
    $served = [];
    foreach (servedRoutes() as [$methods, $path]) {
        foreach ($methods as $method) {
            $served[] = "{$method} {$path}";
        }
    }

    $stale = [];
    foreach (documentedEndpoints() as [$methods, $path]) {
        if (! collect(explode('|', $methods))->contains(fn ($method) => in_array("{$method} {$path}", $served, true))) {
            $stale[] = "{$methods} {$path}";
        }
    }

    expect($stale)->toBe([]);
});

it('documents each route once', function () {
    $headings = array_map(fn ($d) => $d[0].' '.$d[1], documentedEndpoints());

    expect(array_diff_assoc($headings, array_unique($headings)))->toBe([]);
});

it('documents every broadcast event, and only events that exist', function () {
    $events = [];
    foreach (glob(dirname(__DIR__, 3).'/app/Events/*.php') as $file) {
        if (preg_match("/function broadcastAs\(\): string\s*\{\s*return '([a-z_.]+)';/", file_get_contents($file), $m)) {
            $events[] = $m[1];
        }
    }

    preg_match_all('/^### `([a-z_]+\.[a-z_]+)`$/m', apiDocs(), $documented);

    expect($events)->not->toBeEmpty()
        ->and(array_values(array_diff($events, $documented[1])))->toBe([])
        ->and(array_values(array_diff($documented[1], $events)))->toBe([]);
});

it('documents every WebSocket channel', function () {
    preg_match_all("/Broadcast::channel\('([a-z]+\.\{[A-Za-z]+\})'/", file_get_contents(dirname(__DIR__, 3).'/routes/channels.php'), $channels);

    $missing = array_filter($channels[1], fn ($pattern) => ! str_contains(apiDocs(), "`private-{$pattern}`") && ! str_contains(apiDocs(), "`presence-{$pattern}`"));

    expect($channels[1])->not->toBeEmpty()->and(array_values($missing))->toBe([]);
});

it('documents every error code the API can return', function () {
    $codes = [];
    foreach (['RoomConflictException', 'EncryptionConflictException', 'CallConflictException'] as $class) {
        preg_match_all("/new self\('([a-z_]+)'/", file_get_contents(dirname(__DIR__, 3)."/app/Exceptions/{$class}.php"), $m);
        array_push($codes, ...$m[1]);
    }
    preg_match_all("/new RoomConflictException\('([a-z_]+)'/", shell_exec('cat '.dirname(__DIR__, 3).'/app/Actions/Rooms/*.php'), $m);
    array_push($codes, ...$m[1]);

    $missing = array_filter(array_unique($codes), fn ($code) => ! str_contains(apiDocs(), "| `{$code}` |"));

    expect($codes)->not->toBeEmpty()->and(array_values($missing))->toBe([]);
});

it('only links to headings that exist', function () {
    $docs = apiDocs();
    $withoutCode = preg_replace('/```.*?```/s', '', $docs);

    // GitHub's heading anchors: lower case, punctuation dropped (underscores and hyphens stay), spaces become hyphens.
    preg_match_all('/^#{1,6} (.+)$/m', $withoutCode, $headings);
    $anchors = array_map(fn ($h) => str_replace(' ', '-', preg_replace('/[^a-z0-9 _-]/', '', mb_strtolower($h))), $headings[1]);

    preg_match_all('/\]\(#([^)]+)\)/', $withoutCode, $links);
    $broken = array_values(array_unique(array_diff($links[1], $anchors)));

    expect($links[1])->not->toBeEmpty()->and($broken)->toBe([]);
});

it('contains only valid JSON in its json examples', function () {
    preg_match_all('/```json\n(.*?)\n```/s', apiDocs(), $blocks);

    $invalid = [];
    foreach ($blocks[1] as $i => $block) {
        json_decode($block);

        if (json_last_error() !== JSON_ERROR_NONE) {
            $invalid[] = 'example '.($i + 1).': '.json_last_error_msg().' ('.Str::limit($block, 60).')';
        }
    }

    expect($blocks[1])->not->toBeEmpty()->and($invalid)->toBe([]);
});

it('shows no real secrets or internals in its examples', function () {
    $docs = apiDocs();

    expect($docs)->not->toContain('/home/user')->not->toContain('vendor/laravel')->not->toContain('"trace"')
        ->not->toContain('localhost')->not->toContain('livekit.test')
        ->and(preg_match('/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/', $docs))->toBe(0);
});
