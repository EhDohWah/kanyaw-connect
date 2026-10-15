<?php

use App\Models\PushSubscription;
use App\Models\User;
use Database\Factories\PushSubscriptionFactory;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** A browser's `subscription.toJSON()`. */
function browserSubscription(array $overrides = []): array
{
    $keys = PushSubscriptionFactory::browserKeys();

    return array_replace_recursive([
        'endpoint' => 'https://fcm.googleapis.com/fcm/send/'.Str::random(140),
        'expirationTime' => null,
        'keys' => ['p256dh' => $keys['p256dh'], 'auth' => $keys['auth']],
    ], $overrides);
}

describe('GET /push/public-key', function () {
    it('gives the browser the key to subscribe with', function () {
        fakeWebPush();
        signIn();

        $this->getJson('/api/v1/push/public-key')
            ->assertOk()
            ->assertExactJson(['data' => ['enabled' => true, 'public_key' => 'fake-public-key']]);
    });

    it('says push is off when the server has no VAPID keys', function () {
        fakeWebPush()->configured = false;
        signIn();

        $this->getJson('/api/v1/push/public-key')
            ->assertOk()
            ->assertExactJson(['data' => ['enabled' => false, 'public_key' => null]]);
    });

    it('is not public', function () {
        $this->getJson('/api/v1/push/public-key')->assertUnauthorized();
    });
});

describe('POST /push/subscriptions', function () {
    it('stores a browser subscription for the signed-in user', function () {
        $me = signIn();
        $body = browserSubscription();

        $response = $this->postJson('/api/v1/push/subscriptions', $body)
            ->assertCreated()
            ->assertJsonPath('data.endpoint', $body['endpoint'])
            ->assertJsonStructure(['data' => ['id', 'endpoint', 'created_at']])
            ->assertJsonMissingPath('data.keys')
            ->assertJsonMissingPath('data.auth_key')
            ->assertJsonMissingPath('data.p256dh_key');

        $stored = PushSubscription::findOrFail($response->json('data.id'));
        expect($stored->user_id)->toBe($me->id)
            ->and($stored->p256dh_key)->toBe($body['keys']['p256dh'])
            ->and($stored->auth_key)->toBe($body['keys']['auth']);
    });

    it('keeps the auth secret encrypted in the database', function () {
        signIn();
        $body = browserSubscription();

        $this->postJson('/api/v1/push/subscriptions', $body)->assertCreated();

        $raw = DB::table('push_subscriptions')->value('auth_key');
        expect($raw)->not->toContain($body['keys']['auth'])->and($raw)->not->toBe($body['keys']['auth']);
    });

    it('is idempotent for the same browser: it updates instead of duplicating', function () {
        $me = signIn();
        $body = browserSubscription();

        $first = $this->postJson('/api/v1/push/subscriptions', $body)->assertCreated()->json('data.id');

        $fresh = browserSubscription(['endpoint' => $body['endpoint']]);
        $this->postJson('/api/v1/push/subscriptions', $fresh)->assertOk()->assertJsonPath('data.id', $first);

        expect($me->pushSubscriptions()->count())->toBe(1)
            ->and(PushSubscription::find($first)->p256dh_key)->toBe($fresh['keys']['p256dh']);
    });

    it('moves a browser to the person who signs in on it next', function () {
        $endpoint = 'https://fcm.googleapis.com/fcm/send/'.Str::random(140);
        $previous = User::factory()->create();
        PushSubscription::factory()->create(['user_id' => $previous->id, 'endpoint' => $endpoint]);

        $me = signIn();
        $this->postJson('/api/v1/push/subscriptions', browserSubscription(['endpoint' => $endpoint]))->assertOk();

        expect($previous->pushSubscriptions()->count())->toBe(0)
            ->and($me->pushSubscriptions()->count())->toBe(1);
    });

    it('ties the subscription to the login, so signing out ends it', function () {
        $user = User::factory()->create();
        $phone = $user->createToken('phone');
        $laptop = $user->createToken('laptop');

        $this->withToken($phone->plainTextToken)->postJson('/api/v1/push/subscriptions', browserSubscription())->assertCreated();
        $this->app['auth']->forgetGuards();
        $this->withToken($laptop->plainTextToken)->postJson('/api/v1/push/subscriptions', browserSubscription())->assertCreated();
        $this->app['auth']->forgetGuards();

        expect(PushSubscription::count())->toBe(2);

        $this->withToken($phone->plainTextToken)->postJson('/api/v1/auth/logout')->assertOk();

        expect(PushSubscription::count())->toBe(1)
            ->and(PushSubscription::first()->access_token_id)->toBe($laptop->accessToken->id);
    });

    it('accepts endpoints of the known push services', function (string $endpoint) {
        signIn();

        $this->postJson('/api/v1/push/subscriptions', browserSubscription(['endpoint' => $endpoint]))->assertCreated();
    })->with([
        'Chrome / Edge / Android' => 'https://fcm.googleapis.com/fcm/send/abc:APA91bE',
        'Firefox' => 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
        'Firefox (other region)' => 'https://updates-autopush.stage.mozaws.net.push.services.mozilla.com/wpush/v2/x',
        'Safari' => 'https://web.push.apple.com/QGZ0lK',
        'Windows' => 'https://db5p.notify.windows.com/?token=AwYAAAAk',
    ]);

    it('refuses endpoints that could aim the server somewhere else', function (string $endpoint) {
        signIn();

        $this->postJson('/api/v1/push/subscriptions', browserSubscription(['endpoint' => $endpoint]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('endpoint');

        expect(PushSubscription::count())->toBe(0);
    })->with([
        'plain http' => 'http://fcm.googleapis.com/fcm/send/abc',
        'an unknown host' => 'https://example.com/push/abc',
        'a lookalike host' => 'https://fcm.googleapis.com.evil.example/fcm/send/abc',
        'a host that only ends the same way' => 'https://evilfcm.googleapis.com/fcm/send/abc',
        'a bare wildcard domain' => 'https://push.services.mozilla.com/abc',
        'localhost' => 'https://localhost/push',
        'the loopback address' => 'https://127.0.0.1/push',
        'a private address' => 'https://10.0.0.5/push',
        'the cloud metadata address' => 'https://169.254.169.254/latest/meta-data/',
        'an IPv6 address' => 'https://[::1]/push',
        'credentials in the URL' => 'https://fcm.googleapis.com@evil.example/fcm/send/abc',
        'credentials before the real host' => 'https://evil.example@fcm.googleapis.com/fcm/send/abc',
        'a backslash trick' => 'https://evil.example\\@fcm.googleapis.com/fcm/send/abc',
        'another port' => 'https://fcm.googleapis.com:8443/fcm/send/abc',
        'a fragment' => 'https://fcm.googleapis.com/fcm/send/abc#x',
        'a space' => 'https://fcm.googleapis.com/fcm/send/a bc',
        'another scheme' => 'ftp://fcm.googleapis.com/fcm/send/abc',
        'a file' => 'file:///etc/passwd',
        'no scheme' => 'fcm.googleapis.com/fcm/send/abc',
        'something that is not a URL' => 'hello',
        'a very long URL' => 'https://fcm.googleapis.com/fcm/send/'.str_repeat('a', 2100),
    ]);

    it('refuses a missing or non-text endpoint', function (mixed $endpoint) {
        signIn();

        $body = browserSubscription();
        $endpoint === null ? $body = Arr::except($body, 'endpoint') : $body['endpoint'] = $endpoint;

        $this->postJson('/api/v1/push/subscriptions', $body)->assertUnprocessable()->assertJsonValidationErrors('endpoint');
    })->with([
        'missing' => [null],
        'a number' => [123],
        'a list' => [['https://fcm.googleapis.com/x']],
        'a boolean' => [true],
    ]);

    it('refuses keys of the wrong kind', function (array $keys, string $field) {
        signIn();

        $this->postJson('/api/v1/push/subscriptions', browserSubscription(['keys' => $keys]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors("keys.{$field}");
    })->with([
        'p256dh too short' => [['p256dh' => 'AAAA'], 'p256dh'],
        'p256dh is a compressed point' => [['p256dh' => PushSubscriptionFactory::base64Url("\x02".random_bytes(32))], 'p256dh'],
        'p256dh does not start with 0x04' => [['p256dh' => PushSubscriptionFactory::base64Url("\x05".random_bytes(64))], 'p256dh'],
        'p256dh is standard base64, not base64url' => [['p256dh' => str_repeat('+', 86).'A'], 'p256dh'],
        'p256dh has padding' => [['p256dh' => PushSubscriptionFactory::base64Url("\x04".random_bytes(64)).'='], 'p256dh'],
        'auth too short' => [['auth' => PushSubscriptionFactory::base64Url(random_bytes(8))], 'auth'],
        'auth too long' => [['auth' => PushSubscriptionFactory::base64Url(random_bytes(32))], 'auth'],
        'auth is not base64' => [['auth' => '!!!!!!!!!!!!!!!!!!!!!!'], 'auth'],
    ]);

    it('requires the keys', function () {
        signIn();

        $this->postJson('/api/v1/push/subscriptions', ['endpoint' => 'https://fcm.googleapis.com/fcm/send/abc'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['keys', 'keys.p256dh', 'keys.auth']);
    });

    it('limits how many browsers one user can register', function () {
        config(['push.max_subscriptions_per_user' => 2]);
        $me = signIn();
        PushSubscription::factory()->count(2)->create(['user_id' => $me->id]);

        $this->postJson('/api/v1/push/subscriptions', browserSubscription())
            ->assertUnprocessable()
            ->assertJsonValidationErrors('endpoint');

        // Refreshing one you already have is still fine.
        $known = $me->pushSubscriptions()->first();
        $this->postJson('/api/v1/push/subscriptions', browserSubscription(['endpoint' => $known->endpoint]))->assertOk();
    });

    it('is rate limited', function () {
        signIn();

        foreach (range(1, 30) as $_) {
            $this->postJson('/api/v1/push/subscriptions', browserSubscription())->assertCreated();
            config(['push.max_subscriptions_per_user' => 1000]);
        }

        $this->postJson('/api/v1/push/subscriptions', browserSubscription())->assertTooManyRequests();
    });

    it('needs a login', function () {
        $this->postJson('/api/v1/push/subscriptions', browserSubscription())->assertUnauthorized();
    });
});

describe('GET /push/subscriptions', function () {
    it('lists only my subscriptions, without their keys', function () {
        $me = signIn();
        $mine = PushSubscription::factory()->count(2)->create(['user_id' => $me->id]);
        PushSubscription::factory()->create(); // someone else's

        $response = $this->getJson('/api/v1/push/subscriptions')->assertOk();

        expect($response->json('data'))->toHaveCount(2)
            ->and(array_column($response->json('data'), 'id'))->toEqualCanonicalizing($mine->pluck('id')->all());
        $response->assertJsonMissingPath('data.0.keys')->assertJsonMissingPath('data.0.auth_key');
    });

    it('needs a login', function () {
        $this->getJson('/api/v1/push/subscriptions')->assertUnauthorized();
    });
});

describe('DELETE /push/subscriptions/{subscription}', function () {
    it('removes my subscription', function () {
        $me = signIn();
        $subscription = PushSubscription::factory()->create(['user_id' => $me->id]);

        $this->deleteJson("/api/v1/push/subscriptions/{$subscription->id}")->assertNoContent();

        expect(PushSubscription::count())->toBe(0);
    });

    it('answers 404 for someone else\'s subscription and leaves it alone', function () {
        signIn();
        $theirs = PushSubscription::factory()->create();

        $this->deleteJson("/api/v1/push/subscriptions/{$theirs->id}")->assertNotFound();

        expect(PushSubscription::count())->toBe(1);
    });

    it('answers 404 for an unknown id', function () {
        signIn();

        $this->deleteJson('/api/v1/push/subscriptions/'.Str::uuid())->assertNotFound();
    });

    it('needs a login', function () {
        $theirs = PushSubscription::factory()->create();

        $this->deleteJson("/api/v1/push/subscriptions/{$theirs->id}")->assertUnauthorized();
    });
});

it('removes a user\'s subscriptions when the account is deleted for good', function () {
    $user = User::factory()->create();
    PushSubscription::factory()->count(2)->create(['user_id' => $user->id]);

    $user->forceDelete();

    expect(PushSubscription::count())->toBe(0);
});
