<?php

use App\Models\User;
use App\Notifications\VerifyEmailNotification;
use Illuminate\Auth\Events\Verified;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;

beforeEach(function () {
    config(['account.frontend_url' => 'https://app.kanyaw.example']);
    Notification::fake();
});

/** The link in the verification email the person was sent (the app's page). */
function verificationLinkFor(User $user): string
{
    $url = null;
    Notification::assertSentTo($user, VerifyEmailNotification::class, function (VerifyEmailNotification $n) use ($user, &$url) {
        $url = $n->toMail($user)->actionUrl;

        return true;
    });

    return $url;
}

/** What the app's page sends to the API, from the link's four values. */
function verifyRequestFrom(string $link, array $change = []): string
{
    parse_str((string) parse_url($link, PHP_URL_QUERY), $q);
    $q = array_merge($q, $change);

    return "/api/v1/auth/email/verify/{$q['id']}/{$q['hash']}?expires={$q['expires']}&signature={$q['signature']}";
}

describe('the verification email', function () {
    it('is sent when someone registers, with a link to the app\'s page', function () {
        $this->postJson('/api/v1/auth/register', [
            'name' => 'Naw Paw',
            'email' => 'paw@example.com',
            'password' => 'secret-password',
            'password_confirmation' => 'secret-password',
        ])->assertCreated()->assertJsonPath('data.email_verified_at', null);

        $user = User::where('email', 'paw@example.com')->firstOrFail();
        $link = verificationLinkFor($user);
        parse_str((string) parse_url($link, PHP_URL_QUERY), $q);

        expect($link)->toStartWith('https://app.kanyaw.example/verify-email?')
            ->and(array_keys($q))->toBe(['id', 'hash', 'expires', 'signature'])
            ->and($q['id'])->toBe($user->id)
            ->and($q['hash'])->toBe(sha1('paw@example.com'));
    });

    it('is queued, and its link works for a day', function () {
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();
        parse_str((string) parse_url(verificationLinkFor($user), PHP_URL_QUERY), $q);

        expect(new VerifyEmailNotification)->toBeInstanceOf(ShouldQueue::class)
            ->and((int) $q['expires'])->toBe(now()->addDay()->getTimestamp());
    });
});

describe('POST /auth/email/verify/{id}/{hash}', function () {
    it('verifies the address from the link, signed out (any device can open the email)', function () {
        Event::fake([Verified::class]);
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();

        $this->postJson(verifyRequestFrom(verificationLinkFor($user)))
            ->assertOk()
            ->assertExactJson(['message' => 'Your email address is verified.', 'verified' => true]);

        expect($user->fresh()->email_verified_at)->not->toBeNull();
        Event::assertDispatched(Verified::class);
    });

    it('says so, and changes nothing, when it was verified already', function () {
        Event::fake([Verified::class]);
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();
        $request = verifyRequestFrom(verificationLinkFor($user));
        $this->postJson($request)->assertOk();
        $first = $user->fresh()->email_verified_at;

        $this->travel(5)->minutes();
        $this->postJson($request)
            ->assertOk()
            ->assertExactJson(['message' => 'Your email address is already verified.', 'verified' => true]);

        expect($user->fresh()->email_verified_at->equalTo($first))->toBeTrue();
        Event::assertDispatchedTimes(Verified::class, 1);
    });

    it('does not show the profile to whoever has the link', function () {
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();

        $response = $this->postJson(verifyRequestFrom(verificationLinkFor($user)))->assertOk();

        expect($response->getContent())->not->toContain($user->email);
    });

    it('refuses a changed signature, id or hash, and a link without one', function () {
        $user = User::factory()->unverified()->create();
        $other = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();
        $link = verificationLinkFor($user);

        $this->postJson(verifyRequestFrom($link, ['signature' => str_repeat('0', 64)]))->assertForbidden();
        $this->postJson(verifyRequestFrom($link, ['id' => $other->id]))->assertForbidden();
        $this->postJson(verifyRequestFrom($link, ['hash' => sha1($other->email)]))->assertForbidden();
        $this->postJson(verifyRequestFrom($link, ['expires' => (string) now()->addYear()->getTimestamp()]))->assertForbidden();
        $this->postJson("/api/v1/auth/email/verify/{$user->id}/".sha1($user->email))->assertForbidden();

        expect($user->fresh()->email_verified_at)->toBeNull()
            ->and($other->fresh()->email_verified_at)->toBeNull();
    });

    it('stops working after a day', function () {
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();
        $request = verifyRequestFrom(verificationLinkFor($user));

        $this->travel(1)->days();
        $this->travel(1)->minutes();

        $this->postJson($request)->assertForbidden();
        expect($user->fresh()->email_verified_at)->toBeNull();
    });

    it('is refused when the address is no longer the one the link was made for', function () {
        $user = User::factory()->unverified()->create(['email' => 'old@example.com']);
        $user->sendEmailVerificationNotification();
        $request = verifyRequestFrom(verificationLinkFor($user));
        $user->forceFill(['email' => 'new@example.com'])->save();

        $this->postJson($request)
            ->assertForbidden()
            ->assertJsonPath('message', 'This verification link is not valid.');
        expect($user->fresh()->email_verified_at)->toBeNull();
    });

    it('answers 404 for an account that is gone', function () {
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();
        $request = verifyRequestFrom(verificationLinkFor($user));
        $user->forceDelete();

        $this->postJson($request)->assertNotFound();
    });

    it('does not depend on the host name the app uses to reach the API', function () {
        $user = User::factory()->unverified()->create();
        $user->sendEmailVerificationNotification();

        $this->postJson('https://api.somewhere-else.example'.verifyRequestFrom(verificationLinkFor($user)))->assertOk();
    });
});

describe('POST /auth/email/verification-notification', function () {
    it('needs a token', function () {
        $this->postJson('/api/v1/auth/email/verification-notification')->assertUnauthorized();
    });

    it('sends a new link', function () {
        $user = User::factory()->unverified()->create();

        $this->withToken($user->createToken('t')->plainTextToken)
            ->postJson('/api/v1/auth/email/verification-notification')
            ->assertOk()
            ->assertExactJson(['message' => 'We have emailed you a new verification link.', 'verified' => false]);

        Notification::assertSentTo($user, VerifyEmailNotification::class);
    });

    it('sends nothing when the address is verified already', function () {
        $user = User::factory()->create();

        $this->withToken($user->createToken('t')->plainTextToken)
            ->postJson('/api/v1/auth/email/verification-notification')
            ->assertOk()
            ->assertExactJson(['message' => 'Your email address is already verified.', 'verified' => true]);

        Notification::assertNothingSent();
    });

    it('sends at most 6 an hour', function () {
        RateLimiter::clear('verification-email');
        $user = User::factory()->unverified()->create();
        $token = $user->createToken('t')->plainTextToken;

        foreach (range(1, 6) as $i) {
            $this->withToken($token)->postJson('/api/v1/auth/email/verification-notification')->assertOk();
        }
        $this->withToken($token)->postJson('/api/v1/auth/email/verification-notification')->assertTooManyRequests();

        Notification::assertSentToTimes($user, VerifyEmailNotification::class, 6);
    });
});

it('changes nothing for an unverified account: it can use the app as before', function () {
    $user = User::factory()->unverified()->create();

    $this->withToken($user->createToken('t')->plainTextToken)->getJson('/api/v1/chats')->assertOk();
});
