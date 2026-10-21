<?php

/*
| The Docker files are how someone runs the app, and the README is how they learn to. These tests keep
| the two in step and catch the mistakes that only show up on someone else's machine: a file the
| Dockerfile copies that does not exist, a setting the compose file reads that nobody explained, a shell
| script that Windows turned into CRLF (the container then fails with "no such file or directory").
*/

function dockerRoot(): string
{
    return dirname(__DIR__, 2);
}

function dockerFile(string $path): string
{
    return file_get_contents(dockerRoot().'/'.$path);
}

/** Names of the variables a compose file reads from the environment: ${NAME} and ${NAME:-default}. */
function composeVariables(): array
{
    $names = [];

    foreach (['docker-compose.yml', 'docker-compose.prod.yml'] as $file) {
        preg_match_all('/\$\{([A-Z][A-Z0-9_]*)/', dockerFile($file), $m);
        array_push($names, ...$m[1]);
    }

    return array_values(array_unique($names));
}

/** @return list<string> the service names of a compose file */
function composeServices(string $file): array
{
    $services = dockerFile($file);
    $services = substr($services, (int) strpos($services, "\nservices:"));
    $services = explode("\nvolumes:", $services)[0];

    preg_match_all('/^  ([a-z][a-z-]*):\s*$/m', $services, $m);

    return $m[1];
}

it('explains every setting the compose files read in the README', function () {
    $missing = array_values(array_filter(composeVariables(), fn ($name) => ! str_contains(dockerFile('README.md'), "`{$name}`")));

    expect(composeVariables())->toContain('APP_PORT', 'FORWARD_DB_PORT', 'SEED_DEMO_DATA', 'LIVEKIT_NODE_IP', 'SERVER_NAME', 'LIVEKIT_DOMAIN')
        ->and($missing)->toBe([]);
});

it('lists the settings only Docker reads in .env.example', function () {
    $readByTheApp = [];
    foreach (glob(dockerRoot().'/config/*.php') as $config) {
        preg_match_all("/env\('([A-Z0-9_]+)'/", file_get_contents($config), $m);
        array_push($readByTheApp, ...$m[1]);
    }

    $dockerOnly = array_values(array_diff(composeVariables(), $readByTheApp));
    $example = dockerFile('.env.example');
    $missing = array_values(array_filter($dockerOnly, fn ($name) => ! preg_match('/^#?\s*'.$name.'=/m', $example)));

    expect($dockerOnly)->toContain('APP_PORT', 'SEED_DEMO_DATA', 'SERVER_NAME')
        ->and($missing)->toBe([]);
});

it('explains every service of docker-compose.yml in the README', function () {
    $services = composeServices('docker-compose.yml');
    $missing = array_values(array_filter($services, fn ($name) => ! str_contains(dockerFile('README.md'), "`{$name}`")));

    expect($services)->toContain('postgres', 'redis', 'migrate', 'app', 'reverb', 'queue', 'scheduler', 'livekit', 'test')
        ->and($missing)->toBe([]);
});

it('only changes services in the other compose files that exist in the main one', function () {
    foreach (['docker-compose.prod.yml', 'docker-compose.override.yml'] as $file) {
        expect(array_values(array_diff(composeServices($file), composeServices('docker-compose.yml'))))->toBe([], $file);
    }
});

it('only copies files into the image that exist', function () {
    preg_match_all('/^COPY\s+(?:--\S+\s+)*(docker\/\S+)\s/m', dockerFile('Dockerfile'), $m);

    $missing = array_values(array_filter($m[1], fn ($path) => ! file_exists(dockerRoot().'/'.$path)));

    expect($m[1])->toContain('docker/Caddyfile', 'docker/entrypoint.sh', 'docker/bootstrap-db.sh')
        ->and($missing)->toBe([]);
});

it('only mounts files from the repository that exist', function () {
    // docker/livekit/livekit.production.yaml is the exception: it holds a secret, so the person
    // deploying creates it and git ignores it.
    preg_match_all('/-\s+\.\/(docker\/[^:\s]+):/', dockerFile('docker-compose.yml'), $m);

    $missing = array_values(array_filter($m[1], fn ($path) => ! file_exists(dockerRoot().'/'.$path)));

    expect($m[1])->not->toBeEmpty()->and($missing)->toBe([]);
});

it('keeps unix line endings in everything a container runs', function () {
    $files = array_merge(
        ['Dockerfile', 'docker-compose.yml', 'docker-compose.prod.yml', 'docker/Caddyfile'],
        array_map(fn ($path) => substr($path, strlen(dockerRoot()) + 1), glob(dockerRoot().'/docker/{*.sh,*/*.sh,*/*.ini}', GLOB_BRACE)),
    );

    $crlf = array_values(array_filter($files, fn ($file) => str_contains(dockerFile($file), "\r")));

    expect($files)->toContain('docker/entrypoint.sh', 'docker/postgres/init-test-db.sh')->and($crlf)->toBe([]);
});

it('never puts a secret or a local settings file into the image', function () {
    $ignore = dockerFile('.dockerignore');

    expect($ignore)->toContain('.env')->toContain('.git')->toContain('vendor')
        ->and(dockerFile('.gitignore'))->toContain('/docker/livekit/livekit.production.yaml');
});

/** The text of one service in docker-compose.override.yml (the watch rules), from its name to the next service. */
function composeServiceBlock(string $name): string
{
    preg_match('/^  '.$name.':\n(.*?)(?=^  [a-z][a-z-]*:\n|\z)/ms', dockerFile('docker-compose.override.yml'), $m);

    return $m[1] ?? '';
}

/** @return list<string> every folder or file `docker compose watch` is told to look at */
function watchedPaths(): array
{
    preg_match_all('/\bpath: (\.\/[^,}\s]+)/', dockerFile('docker-compose.override.yml'), $m);

    return array_values(array_unique($m[1]));
}

it('watches the folders that hold the application code', function () {
    expect(watchedPaths())->toContain('./app', './bootstrap', './config', './database', './routes', './composer.lock', './Dockerfile');
});

it('only watches files and folders that exist', function () {
    $missing = array_values(array_filter(watchedPaths(), fn ($path) => ! file_exists(dockerRoot().'/'.substr($path, 2))));

    expect($missing)->toBe([]);
});

it('copies files only to places inside the application folder of the container', function () {
    preg_match_all('/\btarget: (\/[^,}\s]+)/', dockerFile('docker-compose.override.yml'), $m);
    $outside = array_values(array_filter($m[1], fn ($target) => ! str_starts_with($target, '/app/')));

    // The targets of the volumes are written differently ("storage:/app/storage"), so these are only the watch rules.
    expect($m[1])->not->toBeEmpty()->and($outside)->toBe([]);
});

it('never copies secrets or runtime state into a container', function () {
    $forbidden = array_values(array_filter(watchedPaths(), fn ($path) => in_array($path, ['./.env', './vendor', './storage', './.git', './node_modules'], true)));

    expect($forbidden)->toBe([]);
});

it('restarts the workers that keep code in memory, and nothing else', function () {
    // The web server reads PHP again on every request, and the scheduler starts a new process for each job.
    expect(composeServiceBlock('app'))->not->toContain('*restart-')->toContain('*sync-app')
        ->and(composeServiceBlock('scheduler'))->not->toContain('*restart-')->toContain('*sync-app')
        ->and(composeServiceBlock('queue'))->toContain('*restart-app')->toContain('*restart-config')
        // Reverb does not run application code, and every restart disconnects every client.
        ->and(composeServiceBlock('reverb'))->toContain('*restart-config')->not->toContain('*restart-app');
});

it('rebuilds the image when the packages or the image recipe change', function () {
    foreach (['app', 'reverb', 'queue', 'scheduler'] as $service) {
        expect(composeServiceBlock($service))->toContain('*rebuild-composer-lock')->toContain('*rebuild-dockerfile');
    }
});

it('keeps the watch rules out of production, where the code must not change', function () {
    // docker-compose.override.yml is loaded on its own only when no -f or COMPOSE_FILE names the files, and
    // the production command always names them. So the production file must not carry rules of its own,
    // and the README must never tell anyone to add the override file to a production command.
    $readme = dockerFile('README.md');

    expect(dockerFile('docker-compose.prod.yml'))->not->toContain('develop:')
        ->and($readme)->toContain('-f docker-compose.yml -f docker-compose.prod.yml')
        ->toContain('COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml')
        ->not->toContain('docker-compose.prod.yml -f docker-compose.override.yml')
        ->not->toContain('docker-compose.prod.yml:docker-compose.override.yml');
});

it('explains docker compose watch in the README', function () {
    expect(dockerFile('README.md'))->toContain('docker compose watch')->toContain('docker-compose.override.yml')->toContain('docker compose exec app php artisan migrate');
});
