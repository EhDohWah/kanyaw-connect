<?php

use App\Models\User;
use Illuminate\Support\Facades\Hash;

function registrationPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'Saw Eh Doh',
        'email' => 'eh@example.com',
        'password' => 'secret-password',
        'password_confirmation' => 'secret-password',
    ], $overrides);
}

it('registers a user with a hashed password and defaults', function () {
    $response = $this->postJson('/api/v1/auth/register', registrationPayload(['phone' => '+66 81 234 5678']));

    $response->assertCreated()
        ->assertJsonPath('data.email', 'eh@example.com')
        ->assertJsonPath('data.status', 'offline')
        ->assertJsonPath('data.timezone', 'Asia/Bangkok')
        ->assertJsonPath('data.locale', 'en')
        ->assertJsonMissingPath('data.password');

    $user = User::where('email', 'eh@example.com')->firstOrFail();
    expect($user->id)->toBeUuid()
        ->and($user->password)->not->toBe('secret-password')
        ->and(Hash::check('secret-password', $user->password))->toBeTrue();
});

it('serialises empty settings as an object, not an array', function () {
    $user = User::factory()->create();

    $content = $this->withToken($user->createToken('t')->plainTextToken)->get('/api/v1/me')->getContent();

    expect($content)->toContain('"settings":{}');
});

it('normalises the email to lower case', function () {
    $this->postJson('/api/v1/auth/register', registrationPayload(['email' => '  Eh@Example.COM ']))->assertCreated();

    expect(User::where('email', 'eh@example.com')->exists())->toBeTrue();
});

it('rejects a duplicate email regardless of case', function () {
    User::factory()->create(['email' => 'eh@example.com']);

    $this->postJson('/api/v1/auth/register', registrationPayload(['email' => 'EH@example.com']))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('email')
        ->assertJsonStructure(['message', 'errors' => ['email']]);
});

it('rejects a duplicate phone number', function () {
    User::factory()->create(['phone' => '+66812345678']);

    $this->postJson('/api/v1/auth/register', registrationPayload(['phone' => '+66812345678']))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('phone');
});

it('requires a confirmed, long enough password', function () {
    $this->postJson('/api/v1/auth/register', registrationPayload(['password_confirmation' => 'different']))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('password');

    $this->postJson('/api/v1/auth/register', registrationPayload(['password' => 'short', 'password_confirmation' => 'short']))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('password');
});

it('requires name and email', function () {
    $this->postJson('/api/v1/auth/register', [])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['name', 'email', 'password']);
});
