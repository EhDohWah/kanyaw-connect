<?php

use App\Models\Device;
use App\Models\User;
use Database\Factories\DeviceFactory;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->me = signIn();
});

describe('listing', function () {
    it('lists only my active devices, with their remaining prekeys', function () {
        $first = makeDevice($this->me, 5, ['created_at' => now()->subHour()]);
        $second = makeDevice($this->me, 0, ['created_at' => now()->subMinutes(10)]);
        makeDevice($this->me, 3)->update(['revoked_at' => now()]);
        makeDevice(User::factory()->create(), 4);

        $rows = $this->getJson('/api/v1/devices')->assertOk()->json('data');

        expect(collect($rows)->pluck('id')->all())->toBe([$first->id, $second->id])
            ->and(collect($rows)->pluck('unclaimed_prekeys')->all())->toBe([5, 0]);
    });

    it('does not count claimed prekeys as remaining', function () {
        $device = makeDevice($this->me, 5);
        $device->oneTimePrekeys()->orderBy('key_id')->limit(2)->update(['claimed_at' => now()]);

        $this->getJson('/api/v1/devices')->assertJsonPath('data.0.unclaimed_prekeys', 3);
    });

    it('is empty for someone without devices', function () {
        $this->getJson('/api/v1/devices')->assertOk()->assertJsonCount(0, 'data');
    });

    it('uses the same number of queries for 1 device and for 8', function () {
        makeDevice($this->me, 2);
        $few = countQueries(fn () => $this->getJson('/api/v1/devices')->assertOk());

        foreach (range(1, 7) as $_) {
            makeDevice($this->me, 2);
        }
        $many = countQueries(fn () => $this->getJson('/api/v1/devices')->assertOk()->assertJsonCount(8, 'data'));

        expect($many)->toBe($few);
    });
});

describe('revoking', function () {
    it('revokes a device and deletes its unclaimed prekeys', function () {
        $device = makeDevice($this->me, 6);
        $device->oneTimePrekeys()->orderBy('key_id')->limit(2)->update(['claimed_at' => now()]);

        $this->deleteJson("/api/v1/devices/{$device->id}")->assertNoContent();

        $device->refresh();
        expect($device->revoked_at)->not->toBeNull()
            ->and($device->oneTimePrekeys()->whereNull('claimed_at')->count())->toBe(0)
            ->and($device->oneTimePrekeys()->whereNotNull('claimed_at')->count())->toBe(2); // claimed ones are kept
        $this->getJson('/api/v1/devices')->assertJsonCount(0, 'data');
    });

    it('keeps the encrypted messages that were already sent to it', function () {
        $device = makeDevice($this->me);
        $this->deleteJson("/api/v1/devices/{$device->id}")->assertNoContent();

        expect(Device::find($device->id))->not->toBeNull();
    });

    it('answers 404 the second time', function () {
        $device = makeDevice($this->me);
        $this->deleteJson("/api/v1/devices/{$device->id}")->assertNoContent();

        $this->deleteJson("/api/v1/devices/{$device->id}")->assertNotFound();
    });
});

describe('rotating the signed prekey', function () {
    beforeEach(function () {
        $this->keys = DeviceFactory::keyMaterial(0);
        $this->device = makeDevice($this->me, 0, [
            'identity_public_key' => $this->keys['payload']['identity_public_key'],
            'signed_prekey_id' => 1,
        ]);
    });

    it('replaces the signed prekey', function () {
        $new = DeviceFactory::signedPrekeyFor($this->keys['identity_secret'], 2);
        $this->travel(2)->days();

        $this->putJson("/api/v1/devices/{$this->device->id}/signed-prekey", $new)
            ->assertOk()
            ->assertJsonPath('data.signed_prekey.id', 2)
            ->assertJsonPath('data.signed_prekey.public_key', $new['public_key'])
            ->assertJsonPath('data.signed_prekey.signature', $new['signature']);

        $device = $this->device->fresh();
        expect($device->signed_prekey_id)->toBe(2)
            ->and($device->signed_prekey_public)->toBe($new['public_key'])
            ->and($device->signed_prekey_rotated_at->gt(now()->subMinute()))->toBeTrue();
    });

    it('needs a new id', function () {
        $same = DeviceFactory::signedPrekeyFor($this->keys['identity_secret'], 1);

        $this->putJson("/api/v1/devices/{$this->device->id}/signed-prekey", $same)->assertUnprocessable()->assertJsonValidationErrors('id');
    });

    it('must be signed by this device\'s identity key', function () {
        $forged = DeviceFactory::signedPrekeyFor(DeviceFactory::keyMaterial(0)['identity_secret'], 2);

        $this->putJson("/api/v1/devices/{$this->device->id}/signed-prekey", $forged)->assertUnprocessable()->assertJsonValidationErrors('signature');
        expect($this->device->fresh()->signed_prekey_id)->toBe(1);
    });

    it('validates the key and signature sizes', function () {
        $this->putJson("/api/v1/devices/{$this->device->id}/signed-prekey", ['id' => 2, 'public_key' => 'short', 'signature' => 'short'])
            ->assertUnprocessable()->assertJsonValidationErrors(['public_key', 'signature']);
    });
});

describe('topping up one-time prekeys', function () {
    it('adds prekeys and reports how many are left', function () {
        $device = makeDevice($this->me, 10);
        $keys = DeviceFactory::keyMaterial(30)['payload']['one_time_prekeys'];
        $keys = array_map(fn ($k) => ['id' => $k['id'] + 100] + $k, $keys);

        $this->postJson("/api/v1/devices/{$device->id}/prekeys", ['prekeys' => $keys])
            ->assertCreated()
            ->assertJsonPath('data.unclaimed', 40);

        expect($device->unclaimedPrekeyCount())->toBe(40);
    });

    it('refuses a key id the device already used, even a claimed one', function () {
        $device = makeDevice($this->me, 5);
        $device->oneTimePrekeys()->where('key_id', 1)->update(['claimed_at' => now()]);
        $key = ['id' => 1, 'public_key' => base64_encode(random_bytes(32))];

        $this->postJson("/api/v1/devices/{$device->id}/prekeys", ['prekeys' => [$key]])
            ->assertUnprocessable()->assertJsonValidationErrors('prekeys.0.id');
    });

    it('lets two devices use the same key ids', function () {
        $a = makeDevice($this->me, 3);
        $b = makeDevice($this->me, 3);
        $key = ['id' => 50, 'public_key' => base64_encode(random_bytes(32))];

        $this->postJson("/api/v1/devices/{$a->id}/prekeys", ['prekeys' => [$key]])->assertCreated();
        $this->postJson("/api/v1/devices/{$b->id}/prekeys", ['prekeys' => [['public_key' => base64_encode(random_bytes(32))] + $key]])->assertCreated();
    });

    it('validates the batch', function (array $prekeys, string $field) {
        $device = makeDevice($this->me, 1);

        $this->postJson("/api/v1/devices/{$device->id}/prekeys", ['prekeys' => $prekeys])->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'empty' => [[], 'prekeys'],
        'bad key' => [[['id' => 9, 'public_key' => 'nope']], 'prekeys.0.public_key'],
        'duplicate ids' => [[['id' => 9, 'public_key' => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='], ['id' => 9, 'public_key' => 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=']], 'prekeys.0.id'],
        'private key smuggled' => [[['id' => 9, 'public_key' => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'private_key' => 'x']], 'prekeys.0'],
    ]);

    it('takes at most 100 at a time', function () {
        $device = makeDevice($this->me, 0);
        $keys = array_map(fn ($i) => ['id' => $i, 'public_key' => base64_encode(random_bytes(32))], range(1, 101));

        $this->postJson("/api/v1/devices/{$device->id}/prekeys", ['prekeys' => $keys])->assertUnprocessable()->assertJsonValidationErrors('prekeys');
    });

    it('stops at 200 unclaimed prekeys per device', function () {
        $device = makeDevice($this->me, 195);
        $key = fn (int $id) => ['id' => $id, 'public_key' => base64_encode(random_bytes(32))];

        $this->postJson("/api/v1/devices/{$device->id}/prekeys", ['prekeys' => array_map($key, range(1000, 1009))])
            ->assertUnprocessable()->assertJsonValidationErrors('prekeys');
        expect($device->unclaimedPrekeyCount())->toBe(195);

        $this->postJson("/api/v1/devices/{$device->id}/prekeys", ['prekeys' => array_map($key, range(1000, 1004))])->assertCreated()->assertJsonPath('data.unclaimed', 200);
    });
});

describe('counting prekeys', function () {
    it('reports unclaimed prekeys', function () {
        $device = makeDevice($this->me, 8);
        $device->oneTimePrekeys()->orderBy('key_id')->limit(3)->update(['claimed_at' => now()]);

        $this->getJson("/api/v1/devices/{$device->id}/prekeys/count")->assertOk()->assertJsonPath('data.unclaimed', 5);
    });
});

describe('devices that are not mine', function () {
    it('answers 404 on every device endpoint and changes nothing', function (string $method, string $path, array $body) {
        $theirs = makeDevice(User::factory()->create(), 5);

        $this->json($method, str_replace('{device}', $theirs->id, $path), $body)->assertNotFound();

        expect($theirs->fresh()->revoked_at)->toBeNull()->and($theirs->unclaimedPrekeyCount())->toBe(5);
    })->with([
        'revoke' => ['DELETE', '/api/v1/devices/{device}', []],
        'rotate' => ['PUT', '/api/v1/devices/{device}/signed-prekey', []],
        'top up' => ['POST', '/api/v1/devices/{device}/prekeys', []],
        'count' => ['GET', '/api/v1/devices/{device}/prekeys/count', []],
    ]);

    it('answers 404 for revoked devices too', function () {
        $revoked = makeDevice($this->me, 2, ['revoked_at' => now()]);

        $this->getJson("/api/v1/devices/{$revoked->id}/prekeys/count")->assertNotFound();
    });

    it('answers 404 for devices that do not exist or ids that are not UUIDs', function () {
        $this->deleteJson('/api/v1/devices/'.Str::uuid())->assertNotFound();
        $this->deleteJson('/api/v1/devices/not-a-uuid')->assertNotFound();
    });
});

it('requires authentication on every device endpoint', function (string $method, string $path) {
    $this->app['auth']->forgetGuards();
    $id = Str::uuid();

    $this->withHeader('Authorization', '')->json($method, str_replace('{id}', $id, $path))->assertUnauthorized();
})->with([
    ['GET', '/api/v1/devices'],
    ['DELETE', '/api/v1/devices/{id}'],
    ['PUT', '/api/v1/devices/{id}/signed-prekey'],
    ['POST', '/api/v1/devices/{id}/prekeys'],
    ['GET', '/api/v1/devices/{id}/prekeys/count'],
    ['GET', '/api/v1/users/{id}/key-bundles'],
]);
