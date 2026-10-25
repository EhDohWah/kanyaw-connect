<?php

use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\PasswordChangedNotification;
use App\Notifications\ResetPasswordNotification;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Facades\RateLimiter;

const SAME_ANSWER = 'If an account uses that address, we have emailed it a link to reset the password.';

beforeEach(function () {
    config(['account.frontend_url' => 'https://app.kanyaw.example']);
    Notification::fake();
});

/** The token from the reset email the person was sent. */
function resetTokenFor(User $user): string
{
    $token = null;
    Notification::assertSentTo($user, ResetPasswordNotification::class, function (ResetPasswordNotification $n) use (&$token) {
        $token = $n->token;

        return true;
    });

    return $token;
}

function resetPayload(User $user, string $token, array $overrides = []): array
{
    return array_merge([
        'token' => $token,
        'email' => $user->email,
        'password' => 'brand-new-password',
        'password_confirmation' => 'brand-new-password',
    ], $overrides);
}

describe('POST /auth/forgot-password', function () {
    it('emails a link to the app\'s reset page, with the token and the address', function () {
        $user = User::factory()->create(['email' => 'paw@example.com']);

        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'paw@example.com'])
            ->assertOk()
            ->assertExactJson(['message' => SAME_ANSWER]);

        Notification::assertSentTo($user, ResetPasswordNotification::class, function (ResetPasswordNotification $n) use ($user) {
            $url = $n->toMail($user)->actionUrl;

            return $url === 'https://app.kanyaw.example/reset-password?token='.$n->token.'&email=paw%40example.com';
        });
    });

    it('is queued, so the request answers at once', function () {
        expect(new ResetPasswordNotification('t'))->toBeInstanceOf(ShouldQueue::class);
    });

    it('answers the same for an address with no account, and sends nothing', function () {
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'nobody@example.com'])
            ->assertOk()
            ->assertExactJson(['message' => SAME_ANSWER]);

        Notification::assertNothingSent();
    });

    it('reads the address without caring about case or spaces', function () {
        $user = User::factory()->create(['email' => 'paw@example.com']);

        $this->postJson('/api/v1/auth/forgot-password', ['email' => '  PAW@Example.com '])->assertOk();

        Notification::assertSentTo($user, ResetPasswordNotification::class);
    });

    it('sends one link a minute per address, and still answers the same', function () {
        $user = User::factory()->create();

        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])->assertOk();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email])
            ->assertOk()
            ->assertExactJson(['message' => SAME_ANSWER]);

        Notification::assertSentToTimes($user, ResetPasswordNotification::class, 1);
    });

    it('needs a valid address', function () {
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'not-an-address'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('email');
        $this->postJson('/api/v1/auth/forgot-password', [])->assertJsonValidationErrors('email');
    });

    it('allows 5 requests a minute per IP address', function () {
        RateLimiter::clear('password-reset');

        foreach (range(1, 5) as $i) {
            $this->postJson('/api/v1/auth/forgot-password', ['email' => "n{$i}@example.com"])->assertOk();
        }
        $this->postJson('/api/v1/auth/forgot-password', ['email' => 'n6@example.com'])
            ->assertTooManyRequests()
            ->assertHeader('Retry-After');
    });
});

describe('POST /auth/reset-password', function () {
    it('sets the new password: the old one stops working and the new one signs in', function () {
        Event::fake([PasswordReset::class]);
        $user = User::factory()->create(['password' => 'old-password']);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email]);

        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, resetTokenFor($user)))
            ->assertOk()
            ->assertExactJson(['message' => 'Your password has been reset. Sign in with the new one.']);

        expect(Hash::check('brand-new-password', $user->fresh()->password))->toBeTrue();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'old-password'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'brand-new-password'])->assertOk();
        Event::assertDispatched(PasswordReset::class);
    });

    it('signs out every device, and their push subscriptions go with them', function () {
        $user = User::factory()->create();
        $phone = $user->createToken('phone');
        $user->createToken('laptop');
        PushSubscription::create([
            'user_id' => $user->id,
            'access_token_id' => $phone->accessToken->id,
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/abc',
            'p256dh_key' => str_repeat('a', 87),
            'auth_key' => str_repeat('b', 22),
        ]);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email]);

        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, resetTokenFor($user)))->assertOk();

        expect($user->tokens()->count())->toBe(0)
            ->and(PushSubscription::where('user_id', $user->id)->count())->toBe(0);
        $this->app['auth']->forgetGuards();
        $this->withToken($phone->plainTextToken)->getJson('/api/v1/me')->assertUnauthorized();
    });

    it('emails the person that their password was reset', function () {
        $user = User::factory()->create();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email]);

        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, resetTokenFor($user)))->assertOk();

        Notification::assertSentTo($user, PasswordChangedNotification::class, fn (PasswordChangedNotification $n) => $n->how === 'reset'
            && str_contains(implode(' ', $n->toMail($user)->introLines), 'Every device has been signed out')
            && $n->toMail($user)->actionUrl === 'https://app.kanyaw.example/forgot-password');
    });

    it('verifies the address (the link reached the inbox), and keeps an earlier verification date', function () {
        $unverified = User::factory()->unverified()->create();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $unverified->email]);
        $this->postJson('/api/v1/auth/reset-password', resetPayload($unverified, resetTokenFor($unverified)))->assertOk();
        expect($unverified->fresh()->email_verified_at)->not->toBeNull();

        $verified = User::factory()->create(['email_verified_at' => '2026-01-01 00:00:00']);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $verified->email]);
        $this->postJson('/api/v1/auth/reset-password', resetPayload($verified, resetTokenFor($verified)))->assertOk();
        expect($verified->fresh()->email_verified_at->toDateString())->toBe('2026-01-01');
    });

    it('works once: the same link cannot set a password again', function () {
        $user = User::factory()->create();
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email]);
        $token = resetTokenFor($user);

        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, $token))->assertOk();
        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, $token, ['password' => 'third-password', 'password_confirmation' => 'third-password']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('token');

        expect(Hash::check('brand-new-password', $user->fresh()->password))->toBeTrue();
    });

    it('stops working after 60 minutes', function () {
        $user = User::factory()->create(['password' => 'old-password']);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $user->email]);
        $token = resetTokenFor($user);

        $this->travel(61)->minutes();

        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, $token))->assertJsonValidationErrors('token');
        expect(Hash::check('old-password', $user->fresh()->password))->toBeTrue();
    });

    it('refuses a wrong token, and an unknown address, with the same words', function () {
        $user = User::factory()->create(['password' => 'old-password']);
        Password::broker()->createToken($user);

        $wrongToken = $this->postJson('/api/v1/auth/reset-password', resetPayload($user, 'not-the-token'))->assertUnprocessable();
        $unknown = $this->postJson('/api/v1/auth/reset-password', resetPayload($user, 'not-the-token', ['email' => 'nobody@example.com']))->assertUnprocessable();

        expect($wrongToken->json('errors.token'))->toBe(['This password reset link is not valid or has expired. Ask for a new one.'])
            ->and($unknown->json())->toBe($wrongToken->json())
            ->and(Hash::check('old-password', $user->fresh()->password))->toBeTrue();
        Notification::assertNotSentTo($user, PasswordChangedNotification::class);
    });

    it('keeps the token of one address from resetting another', function () {
        $paw = User::factory()->create();
        $eh = User::factory()->create(['password' => 'eh-password']);
        $this->postJson('/api/v1/auth/forgot-password', ['email' => $paw->email]);

        $this->postJson('/api/v1/auth/reset-password', resetPayload($eh, resetTokenFor($paw)))->assertJsonValidationErrors('token');

        expect(Hash::check('eh-password', $eh->fresh()->password))->toBeTrue();
    });

    it('needs the token, the address, and a confirmed password of at least 8 characters', function () {
        $this->postJson('/api/v1/auth/reset-password', [])->assertJsonValidationErrors(['token', 'email', 'password']);

        $user = User::factory()->create();
        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, 't', ['password' => 'short', 'password_confirmation' => 'short']))
            ->assertJsonValidationErrors('password');
        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, 't', ['password_confirmation' => 'something-else']))
            ->assertJsonValidationErrors('password');
    });

    it('shares the 5-a-minute limit with asking for a link', function () {
        RateLimiter::clear('password-reset');
        $user = User::factory()->create();

        foreach (range(1, 5) as $i) {
            $this->postJson('/api/v1/auth/reset-password', resetPayload($user, "guess-{$i}"))->assertUnprocessable();
        }
        $this->postJson('/api/v1/auth/reset-password', resetPayload($user, 'guess-6'))->assertTooManyRequests();
    });
});
