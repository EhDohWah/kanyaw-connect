<?php

use App\Models\User;

it('completes register -> login -> me -> logout and revokes the token', function () {
    $this->postJson('/api/v1/auth/register', [
        'name' => 'Naw Paw',
        'email' => 'paw@example.com',
        'password' => 'secret-password',
        'password_confirmation' => 'secret-password',
    ])->assertCreated();

    $token = $this->postJson('/api/v1/auth/login', [
        'email' => 'paw@example.com',
        'password' => 'secret-password',
    ])->assertOk()->json('token');

    $this->withToken($token)->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.email', 'paw@example.com');

    $this->withToken($token)->postJson('/api/v1/auth/logout')->assertOk();

    expect(User::where('email', 'paw@example.com')->first()->tokens()->count())->toBe(0);

    // The guard caches the resolved user inside one test process; forget it to simulate a new request.
    $this->app['auth']->forgetGuards();

    $this->withToken($token)->getJson('/api/v1/me')->assertUnauthorized();
});

it('only revokes the token used to log out, not the other devices', function () {
    $user = User::factory()->create();
    $phone = $user->createToken('phone')->plainTextToken;
    $laptop = $user->createToken('laptop')->plainTextToken;

    $this->withToken($phone)->postJson('/api/v1/auth/logout')->assertOk();
    $this->app['auth']->forgetGuards();

    $this->withToken($phone)->getJson('/api/v1/me')->assertUnauthorized();
    $this->app['auth']->forgetGuards();
    $this->withToken($laptop)->getJson('/api/v1/me')->assertOk();
});

it('returns 401 JSON for protected endpoints without a token', function (string $method, string $uri) {
    $this->json($method, $uri)
        ->assertUnauthorized()
        ->assertJsonStructure(['message']);
})->with([
    ['POST', '/api/v1/auth/logout'],
    ['GET', '/api/v1/me'],
    ['PATCH', '/api/v1/me'],
    ['POST', '/api/v1/me/avatar'],
]);

it('returns 401 for a garbage token', function () {
    $this->withToken('1|not-a-real-token')->getJson('/api/v1/me')->assertUnauthorized();
});
