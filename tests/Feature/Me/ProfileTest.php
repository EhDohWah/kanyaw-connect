<?php

use App\Models\User;

it('shows the authenticated profile', function () {
    $user = User::factory()->create(['phone' => '+66812345678']);

    $this->withToken($user->createToken('t')->plainTextToken)
        ->getJson('/api/v1/me')
        ->assertOk()
        ->assertJsonPath('data.id', $user->id)
        ->assertJsonPath('data.phone', '+66812345678')
        ->assertJsonPath('data.avatar_url', null)
        ->assertJsonMissingPath('data.password')
        ->assertJsonMissingPath('data.remember_token');
});

it('updates name, phone, timezone and locale', function () {
    $user = User::factory()->create();

    $this->withToken($user->createToken('t')->plainTextToken)
        ->patchJson('/api/v1/me', [
            'name' => 'New Name',
            'phone' => '+95 9 123 456 789',
            'timezone' => 'Asia/Yangon',
            'locale' => 'ksw',
        ])
        ->assertOk()
        ->assertJsonPath('data.name', 'New Name')
        ->assertJsonPath('data.timezone', 'Asia/Yangon')
        ->assertJsonPath('data.locale', 'ksw');

    expect($user->fresh())
        ->name->toBe('New Name')
        ->phone->toBe('+95 9 123 456 789');
});

it('allows a partial update and leaves other fields alone', function () {
    $user = User::factory()->create(['name' => 'Keep Me']);

    $this->withToken($user->createToken('t')->plainTextToken)
        ->patchJson('/api/v1/me', ['locale' => 'my'])
        ->assertOk();

    expect($user->fresh())->name->toBe('Keep Me')->locale->toBe('my');
});

it('merges settings key by key', function () {
    $user = User::factory()->create(['settings' => ['theme' => 'dark', 'sound' => true]]);
    $token = $user->createToken('t')->plainTextToken;

    $this->withToken($token)
        ->patchJson('/api/v1/me', ['settings' => ['sound' => false, 'compact' => true]])
        ->assertOk()
        ->assertJsonPath('data.settings.theme', 'dark')
        ->assertJsonPath('data.settings.sound', false)
        ->assertJsonPath('data.settings.compact', true);

    // jsonb does not preserve key order, so compare without order.
    expect($user->fresh()->settings)->toEqualCanonicalizing(['theme' => 'dark', 'sound' => false, 'compact' => true]);
});

it('lets a user keep their own phone number', function () {
    $user = User::factory()->create(['phone' => '+66812345678']);

    $this->withToken($user->createToken('t')->plainTextToken)
        ->patchJson('/api/v1/me', ['phone' => '+66812345678'])
        ->assertOk();
});

it('can clear the phone number', function () {
    $user = User::factory()->create(['phone' => '+66812345678']);

    $this->withToken($user->createToken('t')->plainTextToken)
        ->patchJson('/api/v1/me', ['phone' => null])
        ->assertOk()
        ->assertJsonPath('data.phone', null);
});

it('rejects invalid profile values', function (array $payload, string $field) {
    $user = User::factory()->create();

    $this->withToken($user->createToken('t')->plainTextToken)
        ->patchJson('/api/v1/me', $payload)
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'unknown timezone' => [['timezone' => 'Mars/Olympus'], 'timezone'],
    'unsupported locale' => [['locale' => 'fr'], 'locale'],
    'empty name' => [['name' => ''], 'name'],
    'bad phone' => [['phone' => 'call me'], 'phone'],
    'settings not an array' => [['settings' => 'dark'], 'settings'],
]);

it('rejects a phone number that belongs to someone else', function () {
    User::factory()->create(['phone' => '+66812345678']);
    $user = User::factory()->create();

    $this->withToken($user->createToken('t')->plainTextToken)
        ->patchJson('/api/v1/me', ['phone' => '+66812345678'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('phone');
});

it('ignores attempts to change protected fields', function () {
    $user = User::factory()->create(['email' => 'real@example.com']);

    $this->withToken($user->createToken('t')->plainTextToken)
        ->patchJson('/api/v1/me', ['email' => 'hacker@example.com', 'status' => 'online', 'password' => 'x'])
        ->assertOk();

    expect($user->fresh())->email->toBe('real@example.com')->status->value->toBe('offline');
});
