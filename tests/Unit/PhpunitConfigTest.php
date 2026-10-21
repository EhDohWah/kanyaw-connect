<?php

/*
| The tests empty their database (RefreshDatabase). When they run inside a Docker container, or in a
| shell that has the development settings exported, phpunit.xml must still win, otherwise a test run
| would wipe the development data. Laravel reads $_SERVER before $_ENV, and a real environment
| variable lives in $_SERVER, so only <server ... force="true"> beats it: an <env> entry never does.
*/

function phpunitEntries(string $tag): array
{
    $xml = simplexml_load_file(dirname(__DIR__, 2).'/phpunit.xml');
    $entries = [];

    foreach ($xml->php->{$tag} as $entry) {
        $entries[(string) $entry['name']] = ['value' => (string) $entry['value'], 'force' => (string) $entry['force'] === 'true'];
    }

    return $entries;
}

it('forces the settings that decide which database, cache, queue and broadcaster a test touches', function () {
    $forced = array_map(fn ($e) => $e['value'], array_filter(phpunitEntries('server'), fn ($e) => $e['force']));

    expect($forced)->toMatchArray([
        'APP_ENV' => 'testing',
        'DB_CONNECTION' => 'pgsql',
        'DB_DATABASE' => 'kanyaw_connect_test',
        'CACHE_STORE' => 'array',
        'QUEUE_CONNECTION' => 'sync',
        'BROADCAST_CONNECTION' => 'null',
        'SESSION_DRIVER' => 'array',
        'MAIL_MAILER' => 'array',
    ]);
});

it('forces the LiveKit and Reverb settings, so a running stack cannot change what a test sees', function () {
    $forced = array_keys(array_filter(phpunitEntries('server'), fn ($e) => $e['force']));

    expect($forced)->toContain('LIVEKIT_URL', 'LIVEKIT_HOST', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'REVERB_APP_KEY', 'REVERB_APP_SECRET', 'REVERB_HOST');
});

it('does not rely on <env> for those settings, because a real environment variable beats <env>', function () {
    $env = array_keys(phpunitEntries('env'));

    // Where the database is (not which one) is for the environment to decide: laptop, CI or Docker.
    expect($env)->toEqualCanonicalizing(['DB_HOST', 'DB_PORT', 'DB_USERNAME', 'DB_PASSWORD']);
});
