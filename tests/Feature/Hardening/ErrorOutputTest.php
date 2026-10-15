<?php

use App\Models\User;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;

/*
| With APP_DEBUG off (production), an error response is just a message: no exception class, no file
| paths, no line numbers, no stack trace, no SQL. These tests switch debug off and look at every kind
| of error a client can cause.
*/
beforeEach(function () {
    config(['app.debug' => false]);

    Route::middleware('api')->get('/api/v1/__boom', fn () => throw new RuntimeException('secret internal detail /var/www/app/Secret.php'));
});

function expectNoInternals($response): void
{
    $body = $response->getContent();
    $json = $response->json();

    expect($json)->not->toHaveKeys(['exception', 'file', 'line', 'trace'])
        ->and($body)->not->toContain('/home/')->not->toContain('/var/www')->not->toContain('vendor/laravel')
        ->not->toContain('Symfony\\')->not->toContain('Illuminate\\')->not->toContain('App\\')->not->toContain('SQLSTATE')
        ->and($json)->toHaveKey('message');
}

it('does not leak internals in error responses', function (string $method, string $uri, int $status) {
    $this->actingAs(User::factory()->create(), 'sanctum');

    expectNoInternals($this->json($method, $uri, [])->assertStatus($status));
})->with([
    'forbidden (chat you are not in)' => fn () => ['GET', '/api/v1/chats/'.makeGroup(User::factory()->create())->id, 403],
    'not found (unknown route)' => ['GET', '/api/v1/nope', 404],
    'not found (unknown message)' => ['GET', '/api/v1/messages/'.Str::uuid(), 404],
    'method not allowed' => ['DELETE', '/api/v1/me', 405],
    'validation error' => ['POST', '/api/v1/chats/direct', 422],
    'server error' => ['GET', '/api/v1/__boom', 500],
]);

it('does not leak internals when not signed in', function () {
    expectNoInternals($this->getJson('/api/v1/me')->assertUnauthorized());
});

it('does not leak internals when throttled', function () {
    config(['security.api_rate_limit_per_minute' => 1]);
    $this->actingAs(User::factory()->create(), 'sanctum');

    $this->getJson('/api/v1/me')->assertOk();
    expectNoInternals($this->getJson('/api/v1/me')->assertTooManyRequests());
});

it('does not leak internals when channel authorization is refused', function () {
    useReverbForChannelAuth();
    $this->actingAs(User::factory()->create(), 'sanctum');

    $response = $this->postJson('/api/v1/broadcasting/auth', ['socket_id' => '1.2', 'channel_name' => 'private-chat.'.makeGroup(User::factory()->create())->id])
        ->assertForbidden();

    expect($response->json())->not->toHaveKeys(['exception', 'file', 'line', 'trace']);
});

it('answers a server error with a plain message', function () {
    $this->getJson('/api/v1/__boom')->assertStatus(500)->assertExactJson(['message' => 'Server Error']);
});
