<?php

use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\PasswordChangedNotification;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;

beforeEach(fn () => Notification::fake());

function changePayload(array $overrides = []): array
{
    return array_merge([
        'current_password' => 'old-password',
        'password' => 'brand-new-password',
        'password_confirmation' => 'brand-new-password',
    ], $overrides);
}

it('needs a token', function () {
    $this->putJson('/api/v1/me/password', changePayload())->assertUnauthorized();
});

it('changes the password when the current one is right', function () {
    $user = User::factory()->create(['password' => 'old-password']);
    $token = $user->createToken('phone')->plainTextToken;

    $this->withToken($token)->putJson('/api/v1/me/password', changePayload())
        ->assertOk()
        ->assertExactJson(['message' => 'Your password has been changed. Your other devices have been signed out.']);

    expect(Hash::check('brand-new-password', $user->fresh()->password))->toBeTrue();
    $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'old-password'])->assertUnprocessable();
});

it('keeps this device signed in and signs out the others (with their push subscriptions)', function () {
    $user = User::factory()->create(['password' => 'old-password']);
    $phone = $user->createToken('phone');
    $laptop = $user->createToken('laptop');
    PushSubscription::create([
        'user_id' => $user->id,
        'access_token_id' => $laptop->accessToken->id,
        'endpoint' => 'https://fcm.googleapis.com/fcm/send/laptop',
        'p256dh_key' => str_repeat('a', 87),
        'auth_key' => str_repeat('b', 22),
    ]);
    PushSubscription::create([
        'user_id' => $user->id,
        'access_token_id' => $phone->accessToken->id,
        'endpoint' => 'https://fcm.googleapis.com/fcm/send/phone',
        'p256dh_key' => str_repeat('a', 87),
        'auth_key' => str_repeat('b', 22),
    ]);

    $this->withToken($phone->plainTextToken)->putJson('/api/v1/me/password', changePayload())->assertOk();

    expect($user->tokens()->pluck('name')->all())->toBe(['phone'])
        ->and(PushSubscription::where('user_id', $user->id)->pluck('endpoint')->all())->toBe(['https://fcm.googleapis.com/fcm/send/phone']);
    $this->app['auth']->forgetGuards();
    $this->withToken($laptop->plainTextToken)->getJson('/api/v1/me')->assertUnauthorized();
    $this->app['auth']->forgetGuards();
    $this->withToken($phone->plainTextToken)->getJson('/api/v1/me')->assertOk();
});

it('emails the person that their password was changed', function () {
    config(['account.frontend_url' => 'https://app.kanyaw.example']);
    $user = User::factory()->create(['password' => 'old-password']);

    $this->withToken($user->createToken('t')->plainTextToken)->putJson('/api/v1/me/password', changePayload())->assertOk();

    Notification::assertSentTo($user, PasswordChangedNotification::class, fn (PasswordChangedNotification $n) => $n->how === 'changed'
        && str_contains(implode(' ', $n->toMail($user)->introLines), 'Your other devices have been signed out')
        && $n->toMail($user)->actionUrl === 'https://app.kanyaw.example/forgot-password');
    expect(new PasswordChangedNotification('changed'))->toBeInstanceOf(ShouldQueue::class);
});

it('refuses a wrong current password, and changes nothing', function () {
    $user = User::factory()->create(['password' => 'old-password']);
    $user->createToken('laptop');

    $this->withToken($user->createToken('phone')->plainTextToken)
        ->putJson('/api/v1/me/password', changePayload(['current_password' => 'wrong-password']))
        ->assertUnprocessable()
        ->assertJsonPath('errors.current_password.0', 'The current password is incorrect.');

    expect(Hash::check('old-password', $user->fresh()->password))->toBeTrue()
        ->and($user->tokens()->count())->toBe(2);
    Notification::assertNothingSent();
});

it('needs a new password that is confirmed, at least 8 characters, and not the current one', function () {
    $user = User::factory()->create(['password' => 'old-password']);
    $token = $user->createToken('t')->plainTextToken;

    $this->withToken($token)->putJson('/api/v1/me/password', [])->assertJsonValidationErrors(['current_password', 'password']);
    $this->withToken($token)->putJson('/api/v1/me/password', changePayload(['password' => 'short', 'password_confirmation' => 'short']))
        ->assertJsonValidationErrors('password');
    $this->withToken($token)->putJson('/api/v1/me/password', changePayload(['password_confirmation' => 'something-else']))
        ->assertJsonValidationErrors('password');
    $this->withToken($token)->putJson('/api/v1/me/password', changePayload(['password' => 'old-password', 'password_confirmation' => 'old-password']))
        ->assertJsonPath('errors.password.0', 'The new password must be different from the current one.');
});

it('allows 5 tries a minute, so a stolen token cannot guess the current password', function () {
    $user = User::factory()->create(['password' => 'old-password']);
    $token = $user->createToken('t')->plainTextToken;

    foreach (range(1, 5) as $i) {
        $this->withToken($token)->putJson('/api/v1/me/password', changePayload(['current_password' => "guess-{$i}"]))->assertUnprocessable();
    }
    $this->withToken($token)->putJson('/api/v1/me/password', changePayload())->assertTooManyRequests();
    expect(Hash::check('old-password', $user->fresh()->password))->toBeTrue();
});
