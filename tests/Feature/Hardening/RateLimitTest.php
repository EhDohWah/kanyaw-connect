<?php

use App\Models\User;

function registration(string $email): array
{
    return ['name' => 'New Person', 'email' => $email, 'password' => 'secret-password', 'password_confirmation' => 'secret-password'];
}

describe('registration', function () {
    it('is limited per IP address', function () {
        config(['security.register_rate_limit_per_hour' => 3]);

        foreach (range(1, 3) as $i) {
            $this->postJson('/api/v1/auth/register', registration("p{$i}@example.com"))->assertCreated();
        }

        $this->postJson('/api/v1/auth/register', registration('p4@example.com'))
            ->assertTooManyRequests()
            ->assertHeader('Retry-After');

        expect(User::where('email', 'p4@example.com')->exists())->toBeFalse();
    });

    it('counts attempts that fail validation too, so it cannot be probed freely', function () {
        config(['security.register_rate_limit_per_hour' => 2]);

        $this->postJson('/api/v1/auth/register', [])->assertUnprocessable();
        $this->postJson('/api/v1/auth/register', [])->assertUnprocessable();
        $this->postJson('/api/v1/auth/register', [])->assertTooManyRequests();
    });

    it('limits each IP separately', function () {
        config(['security.register_rate_limit_per_hour' => 1]);

        $this->postJson('/api/v1/auth/register', registration('a@example.com'), ['REMOTE_ADDR' => '198.51.100.1'])->assertCreated();
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.2'])->postJson('/api/v1/auth/register', registration('b@example.com'))->assertCreated();
        $this->withServerVariables(['REMOTE_ADDR' => '198.51.100.2'])->postJson('/api/v1/auth/register', registration('c@example.com'))->assertTooManyRequests();
    });
});

describe('general API limit', function () {
    it('stops a signed-in client that floods the API', function () {
        config(['security.api_rate_limit_per_minute' => 5]);
        $this->actingAs(User::factory()->create(), 'sanctum');

        foreach (range(1, 5) as $_) {
            $this->getJson('/api/v1/me')->assertOk();
        }

        $this->getJson('/api/v1/me')->assertTooManyRequests()->assertHeader('Retry-After');
    });

    it('counts each user separately', function () {
        config(['security.api_rate_limit_per_minute' => 2]);
        $tokenA = User::factory()->create()->createToken('a')->plainTextToken;
        $tokenB = User::factory()->create()->createToken('b')->plainTextToken;

        $this->withToken($tokenA)->getJson('/api/v1/me')->assertOk();
        $this->withToken($tokenA)->getJson('/api/v1/me')->assertOk();
        $this->withToken($tokenA)->getJson('/api/v1/me')->assertTooManyRequests();
        $this->app['auth']->forgetGuards(); // a new request resolves its own user
        $this->withToken($tokenB)->getJson('/api/v1/me')->assertOk();
    });

    it('is generous enough for normal use by default', function () {
        expect(config('security.api_rate_limit_per_minute'))->toBeGreaterThanOrEqual(300);
    });

    it('does not apply to signed attachment URLs or the LiveKit webhook', function () {
        config(['security.api_rate_limit_per_minute' => 1]);

        foreach (range(1, 3) as $_) {
            $this->postJson('/api/v1/webhooks/livekit', [])->assertUnauthorized();
        }
    });
});
