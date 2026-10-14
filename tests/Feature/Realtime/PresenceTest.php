<?php

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

function markAlive(User $user): void
{
    Cache::put("presence:user:{$user->id}", now()->timestamp, 90);
}

describe('POST /me/heartbeat', function () {
    it('sets the presence key with a 90 second lifetime and records last_seen_at', function () {
        $me = signIn();
        expect($me->status)->toBe(UserStatus::Offline)->and($me->last_seen_at)->toBeNull();

        $this->postJson('/api/v1/me/heartbeat')->assertNoContent();

        expect(Cache::has("presence:user:{$me->id}"))->toBeTrue()
            ->and($me->fresh()->last_seen_at)->not->toBeNull()
            ->and($me->fresh()->status)->toBe(UserStatus::Online);

        $this->travel(89)->seconds();
        expect(Cache::has("presence:user:{$me->id}"))->toBeTrue();
        $this->travel(2)->seconds();
        expect(Cache::has("presence:user:{$me->id}"))->toBeFalse();
    });

    it('keeps the user\'s own away/busy status when no status is sent', function (UserStatus $status) {
        $me = signIn(User::factory()->create(['status' => $status]));

        $this->postJson('/api/v1/me/heartbeat')->assertNoContent();

        expect($me->fresh()->status)->toBe($status);
    })->with([UserStatus::Away, UserStatus::Busy, UserStatus::Online]);

    it('lets the client report away, busy or online', function (string $status) {
        $me = signIn();

        $this->postJson('/api/v1/me/heartbeat', ['status' => $status])->assertNoContent();

        expect($me->fresh()->status->value)->toBe($status);
    })->with(['online', 'away', 'busy']);

    it('refuses to report offline or an unknown status', function (string $status) {
        $me = signIn();

        $this->postJson('/api/v1/me/heartbeat', ['status' => $status])->assertUnprocessable()->assertJsonValidationErrors('status');
        expect(Cache::has("presence:user:{$me->id}"))->toBeFalse();
    })->with(['offline', 'invisible']);

    it('does not touch updated_at', function () {
        $me = signIn();
        $before = $me->fresh()->updated_at;

        $this->travel(5)->minutes();
        $this->postJson('/api/v1/me/heartbeat')->assertNoContent();

        expect($me->fresh()->updated_at->eq($before))->toBeTrue();
    });

    it('allows 12 a minute per user, then 429', function () {
        signIn();

        foreach (range(1, 12) as $_) {
            $this->postJson('/api/v1/me/heartbeat')->assertNoContent();
        }

        $this->postJson('/api/v1/me/heartbeat')->assertTooManyRequests();
    });

    it('requires authentication', function () {
        $this->postJson('/api/v1/me/heartbeat')->assertUnauthorized();
    });
});

describe('GET /users/presence', function () {
    it('shows people you share a chat with, and yourself', function () {
        $me = signIn();
        $friend = User::factory()->create(['status' => UserStatus::Online]);
        makeDirect($me, $friend);
        markAlive($friend);

        $response = $this->getJson('/api/v1/users/presence?'.http_build_query(['ids' => [$friend->id, $me->id]]))->assertOk();

        $rows = collect($response->json('data'))->keyBy('id');
        expect($rows)->toHaveCount(2)
            ->and($rows[$friend->id]['status'])->toBe('online')
            ->and($rows[$me->id]['status'])->toBe('offline'); // no heartbeat yet
    });

    it('works through a group chat too', function () {
        $me = signIn();
        $member = User::factory()->create(['status' => UserStatus::Busy]);
        makeGroup(User::factory()->create(), [$me, $member]);
        markAlive($member);

        $this->getJson('/api/v1/users/presence?ids[]='.$member->id)
            ->assertOk()
            ->assertJsonPath('data.0.status', 'busy');
    });

    it('leaves out strangers, deleted users and ids that do not exist, without saying why', function () {
        $me = signIn();
        $stranger = User::factory()->create(['status' => UserStatus::Online]);
        markAlive($stranger);
        $gone = User::factory()->create();
        makeDirect($me, $gone);
        $gone->delete();

        $this->getJson('/api/v1/users/presence?'.http_build_query(['ids' => [$stranger->id, $gone->id, (string) Str::uuid()]]))
            ->assertOk()
            ->assertJsonCount(0, 'data');
    });

    it('does not count a chat you left', function () {
        $me = signIn();
        $friend = User::factory()->create();
        $chat = makeGroup($friend, [$me]);
        $chat->chatMembers()->where('user_id', $me->id)->delete();

        $this->getJson('/api/v1/users/presence?ids[]='.$friend->id)->assertJsonCount(0, 'data');
    });

    it('reports offline when the heartbeat has expired, even if the stored status is still online', function () {
        $me = signIn();
        $friend = User::factory()->create(['status' => UserStatus::Online, 'last_seen_at' => now()->subMinutes(10)]);
        makeDirect($me, $friend);
        // No presence key: the heartbeat lapsed and presence:mark-offline has not run yet.

        $this->getJson('/api/v1/users/presence?ids[]='.$friend->id)
            ->assertJsonPath('data.0.status', 'offline')
            ->assertJsonPath('data.0.id', $friend->id);
    });

    it('returns only id, status and last_seen_at', function () {
        $me = signIn();
        $friend = User::factory()->create(['phone' => '+66812345678']);
        makeDirect($me, $friend);

        $response = $this->getJson('/api/v1/users/presence?ids[]='.$friend->id)->assertOk();

        expect(array_keys($response->json('data.0')))->toBe(['id', 'status', 'last_seen_at'])
            ->and($response->getContent())->not->toContain($friend->email)->not->toContain('+66812345678');
    });

    it('accepts 100 ids and rejects 101', function () {
        signIn();
        $ids = fn (int $n) => array_map(fn () => (string) Str::uuid(), range(1, $n));

        $this->getJson('/api/v1/users/presence?'.http_build_query(['ids' => $ids(100)]))->assertOk();
        $this->getJson('/api/v1/users/presence?'.http_build_query(['ids' => $ids(101)]))
            ->assertUnprocessable()->assertJsonValidationErrors('ids');
    });

    it('rejects missing, malformed and duplicate ids', function () {
        signIn();
        $id = (string) Str::uuid();

        $this->getJson('/api/v1/users/presence')->assertUnprocessable()->assertJsonValidationErrors('ids');
        $this->getJson('/api/v1/users/presence?ids[]=abc')->assertUnprocessable()->assertJsonValidationErrors('ids.0');
        $this->getJson("/api/v1/users/presence?ids[]={$id}&ids[]={$id}")->assertUnprocessable()->assertJsonValidationErrors('ids.0');
    });

    it('uses the same number of queries for 2 users and for 30', function () {
        $me = signIn();
        $make = function (int $n) use ($me) {
            return User::factory()->count($n)->create()->each(function (User $u) use ($me) {
                makeDirect($me, $u);
                markAlive($u);
            })->pluck('id')->all();
        };

        $few = $make(2);
        $fewQueries = countQueries(fn () => $this->getJson('/api/v1/users/presence?'.http_build_query(['ids' => $few]))->assertOk());

        $many = [...$few, ...$make(28)];
        $manyQueries = countQueries(fn () => $this->getJson('/api/v1/users/presence?'.http_build_query(['ids' => $many]))->assertOk()->assertJsonCount(30, 'data'));

        expect($manyQueries)->toBe($fewQueries);
    });

    it('requires authentication', function () {
        $this->getJson('/api/v1/users/presence?ids[]='.Str::uuid())->assertUnauthorized();
    });
});

describe('presence:mark-offline', function () {
    it('marks users offline once their heartbeat is gone', function () {
        $stale = User::factory()->create(['status' => UserStatus::Online, 'last_seen_at' => now()->subMinutes(5)]);
        $away = User::factory()->create(['status' => UserStatus::Away, 'last_seen_at' => now()->subMinutes(5)]);
        $neverSeen = User::factory()->create(['status' => UserStatus::Busy, 'last_seen_at' => null]);

        Artisan::call('presence:mark-offline');

        expect($stale->fresh()->status)->toBe(UserStatus::Offline)
            ->and($away->fresh()->status)->toBe(UserStatus::Offline)
            ->and($neverSeen->fresh()->status)->toBe(UserStatus::Offline);
    });

    it('leaves users with a live heartbeat alone', function () {
        $alive = User::factory()->create(['status' => UserStatus::Online, 'last_seen_at' => now()->subSeconds(30)]);
        $busy = User::factory()->create(['status' => UserStatus::Busy, 'last_seen_at' => now()->subSeconds(30)]);
        markAlive($alive);
        markAlive($busy);

        Artisan::call('presence:mark-offline');

        expect($alive->fresh()->status)->toBe(UserStatus::Online)->and($busy->fresh()->status)->toBe(UserStatus::Busy);
    });

    it('does not overwrite a heartbeat that arrived after the check began', function () {
        // No cache key, but last_seen_at is fresh: a heartbeat just landed.
        $user = User::factory()->create(['status' => UserStatus::Online, 'last_seen_at' => now()]);

        Artisan::call('presence:mark-offline');

        expect($user->fresh()->status)->toBe(UserStatus::Online);
    });

    it('reports how many users it changed and ignores users already offline', function () {
        User::factory()->count(2)->create(['status' => UserStatus::Online, 'last_seen_at' => now()->subHour()]);
        User::factory()->create(['status' => UserStatus::Offline]);

        $this->artisan('presence:mark-offline')->expectsOutput('Marked 2 user(s) offline.')->assertSuccessful();
        $this->artisan('presence:mark-offline')->expectsOutput('Marked 0 user(s) offline.')->assertSuccessful();
    });

    it('works through more users than one batch', function () {
        User::factory()->count(1203)->create(['status' => UserStatus::Online, 'last_seen_at' => now()->subHour()]);

        $this->artisan('presence:mark-offline')->expectsOutput('Marked 1203 user(s) offline.');
        expect(User::where('status', '!=', 'offline')->count())->toBe(0);
    });

    it('is scheduled every minute', function () {
        $event = collect(app(Schedule::class)->events())
            ->first(fn ($e) => str_contains($e->command, 'presence:mark-offline'));

        expect($event)->not->toBeNull()->and($event->expression)->toBe('* * * * *');
    });

    it('takes a user offline after the heartbeat stops, end to end', function () {
        $me = signIn();
        $this->postJson('/api/v1/me/heartbeat')->assertNoContent();
        expect($me->fresh()->status)->toBe(UserStatus::Online);

        $this->travel(95)->seconds(); // the 90 s key has expired
        Artisan::call('presence:mark-offline');

        expect($me->fresh()->status)->toBe(UserStatus::Offline);
    });
});
