<?php

use App\Models\User;

it('logs in and returns a token with the user', function () {
    $user = User::factory()->create(['email' => 'eh@example.com']);

    $response = $this->postJson('/api/v1/auth/login', [
        'email' => 'eh@example.com',
        'password' => 'password',
        'device_name' => 'Pixel 7',
    ]);

    $response->assertOk()
        ->assertJsonStructure(['token', 'user' => ['id', 'name', 'email', 'status', 'settings']])
        ->assertJsonPath('user.id', $user->id);

    expect($user->tokens()->first()->name)->toBe('Pixel 7');
});

it('defaults the token name when no device name is sent', function () {
    $user = User::factory()->create();

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();

    expect($user->tokens()->first()->name)->toBe('api');
});

it('treats the email case-insensitively', function () {
    User::factory()->create(['email' => 'eh@example.com']);

    $this->postJson('/api/v1/auth/login', ['email' => 'EH@Example.com', 'password' => 'password'])->assertOk();
});

it('rejects a wrong password', function () {
    $user = User::factory()->create();

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'nope'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('email')
        ->assertJsonMissingPath('token');
});

it('rejects an unknown email with the same error as a wrong password', function () {
    $this->postJson('/api/v1/auth/login', ['email' => 'ghost@example.com', 'password' => 'password'])
        ->assertUnprocessable()
        ->assertJsonPath('errors.email.0', __('auth.failed'));
});

it('does not let a soft deleted user log in', function () {
    $user = User::factory()->create();
    $user->delete();

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
        ->assertUnprocessable();
});

it('rate limits login to 5 attempts per minute per email and IP', function () {
    $user = User::factory()->create();

    foreach (range(1, 5) as $i) {
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'wrong'])
            ->assertUnprocessable();
    }

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
        ->assertTooManyRequests();
});

it('keeps separate rate limit buckets per email', function () {
    $user = User::factory()->create();

    foreach (range(1, 5) as $i) {
        $this->postJson('/api/v1/auth/login', ['email' => 'other@example.com', 'password' => 'wrong']);
    }

    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
});
