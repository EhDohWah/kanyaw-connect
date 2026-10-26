<?php

use App\Models\NativePushToken;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/** Signs in the way the phone app does: a real stored token, sent as a bearer token. */
function signInPhone($test, ?User $user = null, string $device = 'Pixel 7 (Android)'): array
{
    $user ??= User::factory()->create();
    $plain = $user->createToken($device)->plainTextToken;
    $test->withToken($plain);

    return [$user, PersonalAccessToken::findToken($plain)];
}

function fcmToken(): string
{
    return Str::random(40).':'.Str::random(120);
}

describe('POST /push/native-tokens', function () {
    it('registers an Android phone under the login it signed in with', function () {
        [$me, $login] = signInPhone($this);
        $token = fcmToken();

        $response = $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => $token, 'app_version' => '0.1.0'])
            ->assertCreated()
            ->assertJsonPath('data.platform', 'android')
            ->assertJsonPath('data.has_voip_token', false)
            ->assertJsonPath('data.app_version', '0.1.0')
            ->assertJsonStructure(['data' => ['id', 'platform', 'has_voip_token', 'app_version', 'last_seen_at', 'created_at']])
            ->assertJsonMissingPath('data.token')
            ->assertJsonMissingPath('data.voip_token');

        $stored = NativePushToken::findOrFail($response->json('data.id'));
        expect($stored->user_id)->toBe($me->id)
            ->and($stored->personal_access_token_id)->toBe($login->id)
            ->and($stored->token)->toBe($token);
    });

    it('registers an iPhone with its PushKit token', function () {
        signInPhone($this, device: 'iPhone 15 (iOS)');

        $this->postJson('/api/v1/push/native-tokens', [
            'platform' => 'ios',
            'token' => bin2hex(random_bytes(32)),
            'voip_token' => bin2hex(random_bytes(32)),
        ])->assertCreated()->assertJsonPath('data.has_voip_token', true);
    });

    it('is idempotent: the same token refreshes its row instead of adding one', function () {
        signInPhone($this);
        $token = fcmToken();

        $first = $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => $token, 'app_version' => '0.1.0'])
            ->assertCreated()->json('data.id');
        $this->travel(5)->minutes();
        $second = $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => $token, 'app_version' => '0.2.0'])
            ->assertOk()->json('data');

        expect($second['id'])->toBe($first)
            ->and($second['app_version'])->toBe('0.2.0')
            ->and(NativePushToken::count())->toBe(1)
            ->and(NativePushToken::find($first)->last_seen_at->isAfter(now()->subMinute()))->toBeTrue();
    });

    it('moves a token that arrives for a different person (the phone changed hands)', function () {
        $previous = NativePushToken::factory()->create();
        [$me, $login] = signInPhone($this);

        $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => $previous->token])
            ->assertOk()
            ->assertJsonPath('data.id', $previous->id);

        $moved = $previous->fresh();
        expect($moved->user_id)->toBe($me->id)
            ->and($moved->personal_access_token_id)->toBe($login->id)
            ->and(NativePushToken::count())->toBe(1);
    });

    it('takes a PushKit token off the older registration it was on', function () {
        $old = NativePushToken::factory()->ios()->create();
        signInPhone($this, device: 'iPhone 15 (iOS)');

        $this->postJson('/api/v1/push/native-tokens', ['platform' => 'ios', 'token' => bin2hex(random_bytes(32)), 'voip_token' => $old->voip_token])
            ->assertCreated();

        expect($old->fresh()->voip_token)->toBeNull()
            ->and(NativePushToken::where('voip_token', $old->voip_token)->count())->toBe(1);
    });

    it('goes away when the person signs out (the login token is deleted)', function () {
        [, $login] = signInPhone($this);
        $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => fcmToken()])->assertCreated();

        $this->postJson('/api/v1/auth/logout')->assertOk();

        expect(PersonalAccessToken::find($login->id))->toBeNull()
            ->and(NativePushToken::count())->toBe(0);
    });

    it('validates the platform, the token and where a PushKit token may go', function (array $body, string $field) {
        signInPhone($this);

        $this->postJson('/api/v1/push/native-tokens', $body)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'no platform' => [['token' => 'abc'], 'platform'],
        'unknown platform' => [['platform' => 'web', 'token' => 'abc'], 'platform'],
        'no token' => [['platform' => 'android'], 'token'],
        'too long' => [['platform' => 'android', 'token' => str_repeat('a', 4097)], 'token'],
        'PushKit token on Android' => [['platform' => 'android', 'token' => 'abc', 'voip_token' => 'def'], 'voip_token'],
        'long app version' => [['platform' => 'android', 'token' => 'abc', 'app_version' => str_repeat('1', 33)], 'app_version'],
    ]);

    it('refuses a 21st phone for the same person', function () {
        [$me] = signInPhone($this);
        NativePushToken::factory()->count(20)->for($me)->create();

        $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => fcmToken()])
            ->assertUnprocessable()->assertJsonValidationErrors('token');
    });

    it('allows 20 registrations an hour per person', function () {
        signInPhone($this);

        foreach (range(1, 20) as $i) {
            $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => "token-{$i}"])->assertSuccessful();
        }

        $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => 'token-21'])->assertTooManyRequests();
    });

    it('needs a bearer token (403 for a session without one)', function () {
        signIn(); // Sanctum::actingAs: no stored token

        $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => fcmToken()])->assertForbidden();
    });

    it('is not public', function () {
        $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => fcmToken()])->assertUnauthorized();
    });

    it('never writes the token to the database log or the response', function () {
        signInPhone($this);
        $token = fcmToken();

        $content = $this->postJson('/api/v1/push/native-tokens', ['platform' => 'android', 'token' => $token])->assertCreated()->getContent();

        expect($content)->not->toContain($token)
            ->and(DB::table('native_push_tokens')->value('token'))->toBe($token);
    });
});

describe('DELETE /push/native-tokens/{id}', function () {
    it('lets the owner remove their phone', function () {
        [$me] = signInPhone($this);
        $registration = NativePushToken::factory()->for($me)->create();

        $this->deleteJson("/api/v1/push/native-tokens/{$registration->id}")->assertNoContent();

        expect(NativePushToken::find($registration->id))->toBeNull();
    });

    it("answers 404 for someone else's registration, and leaves it alone", function () {
        $theirs = NativePushToken::factory()->create();
        signInPhone($this);

        $this->deleteJson("/api/v1/push/native-tokens/{$theirs->id}")->assertNotFound();

        expect(NativePushToken::find($theirs->id))->not->toBeNull();
    });

    it('answers 404 for an id that does not exist', function () {
        signInPhone($this);

        $this->deleteJson('/api/v1/push/native-tokens/'.Str::uuid())->assertNotFound();
    });

    it('is not public', function () {
        $registration = NativePushToken::factory()->create();

        $this->deleteJson("/api/v1/push/native-tokens/{$registration->id}")->assertUnauthorized();
    });
});
