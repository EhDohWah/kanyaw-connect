<?php

use App\Models\User;

function loginAs(User $user, string $device = 'Pixel 7')
{
    return test()->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password', 'device_name' => $device]);
}

it('issues tokens that last 30 days and tells the client when they expire', function () {
    $this->freezeTime();
    $user = User::factory()->create();

    $response = loginAs($user)->assertOk();

    expect(config('sanctum.expiration'))->toBe(43200)
        ->and($response->json('expires_at'))->toBe(now()->addDays(30)->toJSON())
        ->and($user->tokens()->first()->expires_at->toIso8601String())->toBe(now()->addDays(30)->toIso8601String());
});

it('accepts a token on day 29 and refuses it after day 30', function () {
    $user = User::factory()->create();
    $token = loginAs($user)->json('token');

    $this->travel(29)->days();
    $this->withToken($token)->getJson('/api/v1/me')->assertOk();

    $this->app['auth']->forgetGuards();
    $this->travel(2)->days();
    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
});

it('also expires a token that was created without an expires_at', function () {
    $token = User::factory()->create()->createToken('legacy')->plainTextToken;

    $this->travel(31)->days();

    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
});

it('does not extend a token just because it is being used', function () {
    $token = loginAs(User::factory()->create())->json('token');

    foreach ([9, 10, 10] as $days) { // day 9, 19, 29: always in use, never extended
        $this->travel($days)->days();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/v1/me')->assertOk();
    }

    $this->travel(2)->days(); // day 31
    $this->app['auth']->forgetGuards();
    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
});

it('gives each device its own expiry', function () {
    $user = User::factory()->create();
    $phone = loginAs($user, 'phone')->json('token');

    $this->travel(20)->days();
    $laptop = loginAs($user, 'laptop')->json('token');

    $this->travel(15)->days(); // phone is 35 days old, laptop 15
    $this->withToken($laptop)->getJson('/api/v1/me')->assertOk();
    $this->app['auth']->forgetGuards();
    $this->withToken($phone)->getJson('/api/v1/me')->assertUnauthorized();
});

it('honours another lifetime from the configuration', function () {
    config(['sanctum.expiration' => 60]);
    $this->freezeTime();

    loginAs(User::factory()->create())->assertJsonPath('expires_at', now()->addHour()->toJSON());
});

it('can be configured so tokens never expire', function () {
    config(['sanctum.expiration' => null]);
    $user = User::factory()->create();

    loginAs($user)->assertOk()->assertJsonPath('expires_at', null);

    expect($user->tokens()->first()->expires_at)->toBeNull();
});

it('deletes tokens that expired more than a day ago', function () {
    $user = User::factory()->create();
    $old = $user->createToken('old', ['*'], now()->addDays(30));
    $fresh = $user->createToken('fresh', ['*'], now()->addDays(30));

    $this->travel(32)->days();
    $fresh->accessToken->forceFill(['created_at' => now(), 'expires_at' => now()->addDays(30)])->save();

    $this->artisan('sanctum:prune-expired', ['--hours' => 24])->assertSuccessful();

    expect($user->tokens()->pluck('name')->all())->toBe(['fresh']);
});
