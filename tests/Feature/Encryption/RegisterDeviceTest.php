<?php

use App\Models\Device;
use App\Models\OneTimePrekey;
use App\Models\User;
use Database\Factories\DeviceFactory;

function registrationBody(int $prekeys = 20, array $overrides = []): array
{
    return array_merge(['name' => 'Pixel 7'], DeviceFactory::keyMaterial($prekeys)['payload'], $overrides);
}

beforeEach(function () {
    $this->me = signIn();
});

it('registers a device from public keys only', function () {
    $body = registrationBody();

    $response = $this->postJson('/api/v1/devices', $body)
        ->assertCreated()
        ->assertJsonPath('data.name', 'Pixel 7')
        ->assertJsonPath('data.identity_public_key', $body['identity_public_key'])
        ->assertJsonPath('data.exchange_public_key', $body['exchange_public_key'])
        ->assertJsonPath('data.signed_prekey.id', 1)
        ->assertJsonPath('data.signed_prekey.public_key', $body['signed_prekey']['public_key'])
        ->assertJsonPath('data.signed_prekey.signature', $body['signed_prekey']['signature'])
        ->assertJsonPath('data.unclaimed_prekeys', 20)
        ->assertJsonMissingPath('data.one_time_prekeys');

    $device = Device::findOrFail($response->json('data.id'));
    expect($device->id)->toBeUuid()
        ->and($device->user_id)->toBe($this->me->id)
        ->and($device->revoked_at)->toBeNull()
        ->and($device->last_active_at)->not->toBeNull()
        ->and($device->signed_prekey_rotated_at)->not->toBeNull()
        ->and($device->oneTimePrekeys()->count())->toBe(20)
        ->and($device->oneTimePrekeys()->whereNull('claimed_at')->count())->toBe(20);
});

it('stores the keys exactly as sent', function () {
    $body = registrationBody();

    $device = Device::findOrFail($this->postJson('/api/v1/devices', $body)->json('data.id'));

    expect($device->identity_public_key)->toBe($body['identity_public_key'])
        ->and($device->oneTimePrekeys()->orderBy('key_id')->pluck('public_key')->all())
        ->toBe(array_column($body['one_time_prekeys'], 'public_key'));
});

it('accepts between 20 and 100 one-time prekeys and nothing outside that', function (int $count, int $status) {
    $this->postJson('/api/v1/devices', registrationBody($count))->assertStatus($status);
})->with([
    'one short' => [19, 422],
    'minimum' => [20, 201],
    'maximum' => [100, 201],
    'one over' => [101, 422],
    'none' => [0, 422],
]);

it('rejects malformed keys', function (array $overrides, string $field) {
    $this->postJson('/api/v1/devices', registrationBody(20, $overrides))->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'identity key too short' => [['identity_public_key' => base64_encode(random_bytes(31))], 'identity_public_key'],
    'identity key too long' => [['identity_public_key' => base64_encode(random_bytes(33))], 'identity_public_key'],
    'identity key not base64' => [['identity_public_key' => 'not base64 at all!!!!'], 'identity_public_key'],
    'identity key url-safe base64' => [['identity_public_key' => str_repeat('-', 43).'='], 'identity_public_key'],
    'identity key missing padding' => [['identity_public_key' => rtrim(base64_encode(random_bytes(32)), '=')], 'identity_public_key'],
    'exchange key wrong size' => [['exchange_public_key' => base64_encode(random_bytes(16))], 'exchange_public_key'],
    'no name' => [['name' => ''], 'name'],
    'name too long' => [['name' => str_repeat('a', 101)], 'name'],
]);

it('rejects a malformed signed prekey', function (array $signed, string $field) {
    $body = registrationBody();
    $body['signed_prekey'] = array_merge($body['signed_prekey'], $signed);

    $this->postJson('/api/v1/devices', $body)->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'negative id' => [['id' => -1], 'signed_prekey.id'],
    'id too large' => [['id' => 2147483648], 'signed_prekey.id'],
    'id not a number' => [['id' => 'abc'], 'signed_prekey.id'],
    'public key wrong size' => [['public_key' => base64_encode(random_bytes(31))], 'signed_prekey.public_key'],
    'signature wrong size' => [['signature' => base64_encode(random_bytes(63))], 'signed_prekey.signature'],
    'private key smuggled in' => [['private_key' => base64_encode(random_bytes(32))], 'signed_prekey'],
]);

it('rejects malformed one-time prekeys', function (Closure $change, string $field) {
    $body = registrationBody();
    $body['one_time_prekeys'] = $change($body['one_time_prekeys']);

    $this->postJson('/api/v1/devices', $body)->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'duplicate id' => [function (array $keys) {
        $keys[1]['id'] = $keys[0]['id'];

        return $keys;
    }, 'one_time_prekeys.1.id'],
    'duplicate key' => [function (array $keys) {
        $keys[1]['public_key'] = $keys[0]['public_key'];

        return $keys;
    }, 'one_time_prekeys.1.public_key'],
    'wrong size' => [function (array $keys) {
        $keys[3]['public_key'] = base64_encode(random_bytes(30));

        return $keys;
    }, 'one_time_prekeys.3.public_key'],
    'negative id' => [function (array $keys) {
        $keys[2]['id'] = -5;

        return $keys;
    }, 'one_time_prekeys.2.id'],
    'smuggled private key' => [function (array $keys) {
        $keys[0]['private_key'] = 'x';

        return $keys;
    }, 'one_time_prekeys.0'],
]);

it('rejects a signed prekey that was not signed by the identity key', function () {
    $body = registrationBody();
    $someoneElse = DeviceFactory::keyMaterial(0)['identity_secret'];
    $body['signed_prekey'] = DeviceFactory::signedPrekeyFor($someoneElse, 1);

    $this->postJson('/api/v1/devices', $body)
        ->assertUnprocessable()
        ->assertJsonValidationErrors('signed_prekey.signature');

    expect(Device::count())->toBe(0)->and(OneTimePrekey::count())->toBe(0);
});

it('rejects a signature over the wrong key', function () {
    $keys = DeviceFactory::keyMaterial();
    $body = array_merge(['name' => 'x'], $keys['payload']);
    // A valid signature, but over a different prekey than the one being uploaded.
    $other = DeviceFactory::signedPrekeyFor($keys['identity_secret'], 1);
    $body['signed_prekey']['signature'] = $other['signature'];

    $this->postJson('/api/v1/devices', $body)->assertUnprocessable()->assertJsonValidationErrors('signed_prekey.signature');
});

it('rejects registering someone else\'s identity key, which cannot be signed for without their private key', function () {
    $victim = makeDevice();
    $body = registrationBody(20, ['identity_public_key' => $victim->identity_public_key]);

    // The victim's identity key is already taken, and the attacker cannot sign a prekey for it anyway.
    $this->postJson('/api/v1/devices', $body)->assertUnprocessable()->assertJsonValidationErrors('identity_public_key');
});

it('can skip the signature check when it is switched off', function () {
    config(['e2ee.verify_signed_prekey' => false]);
    $body = registrationBody();
    $body['signed_prekey']['signature'] = base64_encode(random_bytes(64));

    $this->postJson('/api/v1/devices', $body)->assertCreated();
});

it('does not allow the same identity key twice', function () {
    $body = registrationBody();
    $this->postJson('/api/v1/devices', $body)->assertCreated();

    $this->postJson('/api/v1/devices', array_merge($body, ['name' => 'again']))
        ->assertUnprocessable()->assertJsonValidationErrors('identity_public_key');
});

it('limits the number of active devices and frees a slot when one is revoked', function () {
    config(['e2ee.max_devices_per_user' => 3]);
    $ids = collect(range(1, 3))->map(fn () => $this->postJson('/api/v1/devices', registrationBody())->assertCreated()->json('data.id'));

    $this->postJson('/api/v1/devices', registrationBody())->assertUnprocessable()->assertJsonValidationErrors('device');
    expect($this->me->devices()->count())->toBe(3);

    $this->deleteJson("/api/v1/devices/{$ids[0]}")->assertNoContent();
    $this->postJson('/api/v1/devices', registrationBody())->assertCreated();
});

it('counts only the user\'s own devices against the limit', function () {
    config(['e2ee.max_devices_per_user' => 1]);
    makeDevice(User::factory()->create());

    $this->postJson('/api/v1/devices', registrationBody())->assertCreated();
});

it('allows 20 registrations an hour', function () {
    config(['e2ee.max_devices_per_user' => 100]);

    foreach (range(1, 20) as $_) {
        $this->postJson('/api/v1/devices', registrationBody(20))->assertCreated();
    }

    $this->postJson('/api/v1/devices', registrationBody(20))->assertTooManyRequests();
});

it('requires authentication', function () {
    $this->app['auth']->forgetGuards();

    $this->withHeader('Authorization', '')->postJson('/api/v1/devices', registrationBody())->assertUnauthorized();
});
