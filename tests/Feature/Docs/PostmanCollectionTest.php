<?php

use Illuminate\Support\Facades\Route;

/*
| docs/postman/kanyaw-connect.postman_collection.json lets someone try every endpoint without a
| frontend (Postman, Bruno and Insomnia all import it). These tests keep it in step with the API:
| a new route must get a request, and a request must not point at a route that is gone.
*/

function postmanCollectionPath(): string
{
    return dirname(__DIR__, 3).'/docs/postman/kanyaw-connect.postman_collection.json';
}

function postmanCollection(): array
{
    return json_decode(file_get_contents(postmanCollectionPath()), true, 512, JSON_THROW_ON_ERROR);
}

/** @return list<array{name: string, method: string, raw: string, test: string}> every request, folders flattened */
function postmanRequests(?array $items = null): array
{
    $requests = [];

    foreach ($items ?? postmanCollection()['item'] as $item) {
        if (isset($item['item'])) {
            array_push($requests, ...postmanRequests($item['item']));

            continue;
        }

        $requests[] = [
            'name' => $item['name'],
            'method' => $item['request']['method'],
            'raw' => $item['request']['url']['raw'],
            'test' => implode("\n", collect($item['event'] ?? [])->flatMap(fn ($e) => $e['script']['exec'])->all()),
        ];
    }

    return $requests;
}

/** "/chats/{{chatId}}/messages?per_page=30" -> "/chats/{}/messages" (the same shape routePatterns() gives). */
function postmanPattern(string $raw): string
{
    $path = explode('?', str_replace('{{baseUrl}}', '', $raw))[0];

    return preg_replace('/\{\{[^}]+\}\}|\{[^}]+\}/', '{}', $path);
}

/** @return list<string> "METHOD /path/{}" for every API route a client can call (not the LiveKit webhook) */
function routePatterns(): array
{
    $patterns = [];

    foreach (Route::getRoutes() as $route) {
        if (! str_starts_with($route->uri(), 'api/v1/') || $route->uri() === 'api/v1/webhooks/livekit') {
            continue;
        }

        foreach (array_diff($route->methods(), ['HEAD']) as $method) {
            $patterns[] = $method.' '.preg_replace('/\{[^}]+\}/', '{}', substr($route->uri(), strlen('api/v1')));
        }
    }

    return array_values(array_unique($patterns));
}

it('is a Postman collection (v2.1) with the variables it needs and a bearer token for every request', function () {
    $collection = postmanCollection();
    $variables = collect($collection['variable'])->pluck('value', 'key');

    expect($collection['info']['schema'])->toContain('v2.1.0')
        ->and($variables['baseUrl'])->toBe('http://localhost:8000/api/v1')
        ->and($variables['token'])->toBe('')
        ->and($collection['auth']['type'])->toBe('bearer')
        ->and($collection['auth']['bearer'][0]['value'])->toBe('{{token}}');
});

it('has a request for every route of the API', function () {
    $have = collect(postmanRequests())->map(fn ($r) => $r['method'].' '.postmanPattern($r['raw']))->unique()->all();

    // A route that answers several methods (GET and POST on /broadcasting/auth) needs only one of them.
    $missing = collect(routePatterns())
        ->groupBy(fn ($pattern) => explode(' ', $pattern, 2)[1])
        ->filter(fn ($patterns) => collect($patterns)->intersect($have)->isEmpty())
        ->map(fn ($patterns) => $patterns->first())
        ->values()
        ->all();

    expect(routePatterns())->toContain('POST /auth/login', 'POST /chats/{}/messages', 'POST /rooms/{}/join')
        ->and($missing)->toBe([]);
});

it('has no request for a route that does not exist', function () {
    $routes = routePatterns();

    $unknown = collect(postmanRequests())
        ->filter(fn ($r) => str_starts_with($r['raw'], '{{baseUrl}}'))   // "Next page" follows links.next, so it has no fixed route
        ->map(fn ($r) => $r['method'].' '.postmanPattern($r['raw']))
        ->reject(fn ($pattern) => in_array($pattern, $routes, true))
        ->unique()
        ->values()
        ->all();

    expect($unknown)->toBe([]);
});

it('logs in and saves the token and the user id for the other requests', function () {
    $logins = array_filter(postmanRequests(), fn ($r) => str_ends_with($r['raw'], '/auth/login'));

    expect($logins)->not->toBeEmpty();

    foreach ($logins as $login) {
        expect($login['test'])->toContain("collectionVariables.set('token'")->toContain("collectionVariables.set('userId'");
    }
});

it('never stores a failed answer over a good variable', function () {
    // Every script that saves a value does it only when there is one (set_var in the generator writes `if (x) { set }`).
    $unguarded = collect(postmanRequests())
        ->filter(fn ($r) => preg_match("/^pm\.collectionVariables\.set\('(?!nextUrl)/m", $r['test']))
        ->pluck('name')
        ->all();

    expect($unguarded)->toBe([]);
});

it('contains no real token or password', function () {
    $json = file_get_contents(postmanCollectionPath());

    expect(preg_match('/\d+\|[A-Za-z0-9]{30,}/', $json))->toBe(0)
        ->and(postmanCollection()['variable'])->toContain(['key' => 'password', 'value' => 'password']);
});

it('is explained in the README', function () {
    expect(file_get_contents(dirname(__DIR__, 3).'/README.md'))->toContain('docs/postman/kanyaw-connect.postman_collection.json');
});
