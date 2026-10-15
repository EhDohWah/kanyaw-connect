<?php

use App\Models\ChatMember;
use App\Models\OneTimePrekey;
use App\Models\User;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->me = signIn();
    $this->friend = User::factory()->create();
    makeDirect($this->me, $this->friend);
});

function fetchBundles($test, User $user, string $query = '', ?string $deviceHeader = null)
{
    $test = $deviceHeader ? $test->withHeader('X-Device-Id', $deviceHeader) : $test;

    return $test->getJson("/api/v1/users/{$user->id}/key-bundles{$query}");
}

it('returns a bundle for each active device, each with one one-time prekey', function () {
    $phone = makeDevice($this->friend, 5, ['created_at' => now()->subHour()]);
    $laptop = makeDevice($this->friend, 5, ['created_at' => now()->subMinutes(5)]);

    $rows = fetchBundles($this, $this->friend)->assertOk()->assertJsonCount(2, 'data')->json('data');

    expect($rows[0])->toBe([
        'device_id' => $phone->id,
        'user_id' => $this->friend->id,
        'identity_public_key' => $phone->identity_public_key,
        'exchange_public_key' => $phone->exchange_public_key,
        'signed_prekey' => [
            'id' => $phone->signed_prekey_id,
            'public_key' => $phone->signed_prekey_public,
            'signature' => $phone->signed_prekey_signature,
        ],
        'one_time_prekey' => ['id' => 1, 'public_key' => $phone->oneTimePrekeys()->where('key_id', 1)->value('public_key')],
    ])
        ->and($rows[1]['device_id'])->toBe($laptop->id)
        ->and($rows[1]['one_time_prekey']['id'])->toBe(1);
});

it('marks the prekeys it hands out as claimed', function () {
    $device = makeDevice($this->friend, 5);

    fetchBundles($this, $this->friend)->assertOk();

    $claimed = $device->oneTimePrekeys()->whereNotNull('claimed_at')->get();
    expect($claimed)->toHaveCount(1)
        ->and($claimed->first()->key_id)->toBe(1)
        ->and($claimed->first()->claimed_by_device_id)->toBeNull()
        ->and($device->unclaimedPrekeyCount())->toBe(4);
});

it('never hands out the same one-time prekey twice', function () {
    makeDevice($this->friend, 4);

    $ids = collect(range(1, 4))->map(fn () => fetchBundles($this, $this->friend)->assertOk()->json('data.0.one_time_prekey.id'));

    expect($ids->all())->toBe([1, 2, 3, 4]);
});

it('returns the device without a one-time prekey once they have run out', function () {
    $device = makeDevice($this->friend, 1);

    fetchBundles($this, $this->friend)->assertJsonPath('data.0.one_time_prekey.id', 1);
    fetchBundles($this, $this->friend)
        ->assertOk()
        ->assertJsonPath('data.0.device_id', $device->id)
        ->assertJsonPath('data.0.one_time_prekey', null)
        ->assertJsonPath('data.0.signed_prekey.id', $device->signed_prekey_id);

    expect($device->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(1);
});

it('leaves out revoked devices and claims nothing from them', function () {
    $active = makeDevice($this->friend, 3);
    $revoked = makeDevice($this->friend, 3, ['revoked_at' => now()]);

    $rows = fetchBundles($this, $this->friend)->assertOk()->json('data');

    expect(collect($rows)->pluck('device_id')->all())->toBe([$active->id])
        ->and($revoked->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(0);
});

it('returns nothing for someone who has no devices', function () {
    fetchBundles($this, $this->friend)->assertOk()->assertJsonCount(0, 'data');
});

it('records which device claimed the prekey', function () {
    $mine = makeDevice($this->me);
    $device = makeDevice($this->friend, 3);

    fetchBundles($this, $this->friend, '', $mine->id)->assertOk();

    expect($device->oneTimePrekeys()->whereNotNull('claimed_at')->first()->claimed_by_device_id)->toBe($mine->id);
});

it('can be limited to particular devices, so prekeys are not wasted on ones you already know', function () {
    $known = makeDevice($this->friend, 3);
    $new = makeDevice($this->friend, 3);

    $rows = fetchBundles($this, $this->friend, "?device_ids[]={$new->id}")->assertOk()->json('data');

    expect(collect($rows)->pluck('device_id')->all())->toBe([$new->id])
        ->and($known->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(0)
        ->and($new->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(1);
});

it('does not let the device filter reach another user\'s devices', function () {
    $someoneElses = makeDevice(User::factory()->create(), 3);

    fetchBundles($this, $this->friend, "?device_ids[]={$someoneElses->id}")->assertOk()->assertJsonCount(0, 'data');

    expect($someoneElses->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(0);
});

it('validates the device filter', function () {
    fetchBundles($this, $this->friend, '?device_ids[]=nope')->assertUnprocessable()->assertJsonValidationErrors('device_ids.0');
});

describe('my own bundles (to sync my other devices)', function () {
    it('skips the device making the request', function () {
        $current = makeDevice($this->me, 3);
        $other = makeDevice($this->me, 3);

        $rows = fetchBundles($this, $this->me, '', $current->id)->assertOk()->json('data');

        expect(collect($rows)->pluck('device_id')->all())->toBe([$other->id])
            ->and($current->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(0);
    });

    it('returns all of them when no device is named', function () {
        makeDevice($this->me, 3);
        makeDevice($this->me, 3);

        fetchBundles($this, $this->me)->assertOk()->assertJsonCount(2, 'data');
    });
});

describe('who may ask', function () {
    it('works for people I share a group chat with', function () {
        $member = User::factory()->create();
        makeDevice($member, 2);
        makeGroup(User::factory()->create(), [$this->me, $member]);

        fetchBundles($this, $member)->assertOk()->assertJsonCount(1, 'data');
    });

    it('answers 404 for strangers and claims nothing', function () {
        $stranger = User::factory()->create();
        $device = makeDevice($stranger, 5);

        fetchBundles($this, $stranger)->assertNotFound();

        expect($device->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(0);
    });

    it('answers 404 once the shared chat is gone', function () {
        $device = makeDevice($this->friend, 3);
        $chat = makeGroup($this->friend, [$this->me]);
        // makeDirect in beforeEach also shared a chat; remove both memberships
        ChatMember::where('user_id', $this->me->id)->delete();

        fetchBundles($this, $this->friend)->assertNotFound();
        expect($device->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(0);
    });

    it('answers 404 for users that do not exist or ids that are not UUIDs', function () {
        $this->getJson('/api/v1/users/'.Str::uuid().'/key-bundles')->assertNotFound();
        $this->getJson('/api/v1/users/not-a-uuid/key-bundles')->assertNotFound();
    });

    it('rejects a device header that is not mine', function () {
        $theirs = makeDevice($this->friend, 2);

        fetchBundles($this, $this->friend, '', $theirs->id)->assertForbidden();

        expect($theirs->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(0);
    });

    it('rejects a revoked device of mine', function () {
        $old = makeDevice($this->me, 0, ['revoked_at' => now()]);
        makeDevice($this->friend, 2);

        fetchBundles($this, $this->friend, '', $old->id)->assertForbidden();
    });
});

describe('rate limit: 10 a minute per requester per target', function () {
    it('stops the 11th request and spares the prekeys', function () {
        $device = makeDevice($this->friend, 30);

        foreach (range(1, 10) as $_) {
            fetchBundles($this, $this->friend)->assertOk();
        }
        fetchBundles($this, $this->friend)->assertTooManyRequests();

        expect($device->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(10);
    });

    it('is separate for each target', function () {
        $other = User::factory()->create();
        makeDirect($this->me, $other);
        makeDevice($this->friend, 20);
        makeDevice($other, 20);

        foreach (range(1, 10) as $_) {
            fetchBundles($this, $this->friend)->assertOk();
        }

        fetchBundles($this, $this->friend)->assertTooManyRequests();
        fetchBundles($this, $other)->assertOk();
    });

    it('is separate for each requester', function () {
        makeDevice($this->friend, 30);
        foreach (range(1, 10) as $_) {
            fetchBundles($this, $this->friend)->assertOk();
        }
        fetchBundles($this, $this->friend)->assertTooManyRequests();

        $another = signIn(User::factory()->create());
        makeDirect($another, $this->friend);
        fetchBundles($this, $this->friend)->assertOk();
    });

    it('applies after the first minute passes', function () {
        makeDevice($this->friend, 30);
        foreach (range(1, 10) as $_) {
            fetchBundles($this, $this->friend)->assertOk();
        }
        fetchBundles($this, $this->friend)->assertTooManyRequests();

        $this->travel(61)->seconds();

        fetchBundles($this, $this->friend)->assertOk();
    });
});

it('is all public data: no device names and nothing resembling a private key', function () {
    $device = makeDevice($this->friend, 3, ['name' => 'Eh Doh\'s secret phone']);

    $content = fetchBundles($this, $this->friend)->assertOk()->getContent();

    expect($content)->not->toContain('secret phone')->not->toContain('name')
        ->not->toContain($this->friend->email)->not->toContain('private')->not->toContain('secret');
});

it('is a single atomic claim for all of a user\'s devices', function () {
    makeDevice($this->friend, 3);
    makeDevice($this->friend, 3);

    fetchBundles($this, $this->friend)->assertOk();

    expect(OneTimePrekey::whereNotNull('claimed_at')->count())->toBe(2);
});
