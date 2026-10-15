<?php

use App\Events\DeviceAdded;
use App\Events\DeviceRevoked;
use App\Models\User;
use Database\Factories\DeviceFactory;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;

beforeEach(function () {
    Event::fake([DeviceAdded::class, DeviceRevoked::class]);
    $this->me = signIn();
});

function addDeviceViaApi($test)
{
    return $test->postJson('/api/v1/devices', array_merge(['name' => 'New phone'], DeviceFactory::keyMaterial()['payload']));
}

describe('device.added', function () {
    it('tells the owner and everyone who shares an encrypted chat with them', function () {
        $encryptedContact = User::factory()->create();
        $groupMember = User::factory()->create();
        makeEncryptedDirect($this->me, $encryptedContact);
        makeEncryptedGroup(User::factory()->create(), [$this->me, $groupMember]);

        $id = addDeviceViaApi($this)->assertCreated()->json('data.id');

        Event::assertDispatchedTimes(DeviceAdded::class, 1);
        Event::assertDispatched(DeviceAdded::class, function (DeviceAdded $event) use ($id, $encryptedContact, $groupMember) {
            expect($event->broadcastAs())->toBe('device.added')
                ->and(channelNames($event))->toContain(
                    "private-user.{$this->me->id}",
                    "private-user.{$encryptedContact->id}",
                    "private-user.{$groupMember->id}",
                )
                ->and(payloadOf($event))->toBe(['user_id' => $this->me->id, 'device_id' => $id]);

            return true;
        });
    });

    it('does not tell people the owner only has plaintext chats with', function () {
        $plainContact = User::factory()->create();
        makeDirect($this->me, $plainContact);
        makeGroup(User::factory()->create(), [$this->me, User::factory()->create()]);

        addDeviceViaApi($this)->assertCreated();

        Event::assertDispatched(DeviceAdded::class, fn (DeviceAdded $e) => channelNames($e) === ["private-user.{$this->me->id}"]);
    });

    it('does not tell strangers', function () {
        $stranger = User::factory()->create();
        makeEncryptedDirect(User::factory()->create(), $stranger);

        addDeviceViaApi($this)->assertCreated();

        Event::assertDispatched(DeviceAdded::class, fn (DeviceAdded $e) => ! in_array("private-user.{$stranger->id}", channelNames($e)));
    });

    it('does not tell people from an encrypted chat the owner left', function () {
        $contact = User::factory()->create();
        $chat = makeEncryptedGroup($contact, [$this->me]);
        $chat->chatMembers()->where('user_id', $this->me->id)->delete();

        addDeviceViaApi($this)->assertCreated();

        Event::assertDispatched(DeviceAdded::class, fn (DeviceAdded $e) => ! in_array("private-user.{$contact->id}", channelNames($e)));
    });

    it('carries no keys and no device name', function () {
        makeEncryptedDirect($this->me, User::factory()->create());
        $body = array_merge(['name' => 'Eh Doh\'s private phone'], DeviceFactory::keyMaterial()['payload']);

        $this->postJson('/api/v1/devices', $body)->assertCreated();

        Event::assertDispatched(DeviceAdded::class, function (DeviceAdded $event) use ($body) {
            $json = json_encode($event->broadcastWith());
            expect($json)->not->toContain('private phone')->not->toContain($body['identity_public_key'])->not->toContain($body['exchange_public_key']);

            return true;
        });
    });

    it('is split over several events when more than 100 people need to know', function () {
        $contacts = User::factory()->count(120)->create()->all();
        makeEncryptedGroup($this->me, $contacts);

        addDeviceViaApi($this)->assertCreated();

        $events = Event::dispatched(DeviceAdded::class)->map(fn ($args) => $args[0]);
        $channels = $events->flatMap(fn ($e) => channelNames($e));

        expect($events)->toHaveCount(2)
            ->and($events->every(fn ($e) => count($e->broadcastOn()) <= 100))->toBeTrue()
            ->and($channels->unique())->toHaveCount(121) // 120 contacts + the owner
            ->and($channels)->toHaveCount(121);
    });

    it('is not sent when registration is rejected', function () {
        $this->postJson('/api/v1/devices', ['name' => 'x'])->assertUnprocessable();

        Event::assertNotDispatched(DeviceAdded::class);
    });
});

describe('device.revoked', function () {
    it('goes to the same people', function () {
        $contact = User::factory()->create();
        makeEncryptedDirect($this->me, $contact);
        $device = makeDevice($this->me);

        $this->deleteJson("/api/v1/devices/{$device->id}")->assertNoContent();

        Event::assertDispatched(DeviceRevoked::class, function (DeviceRevoked $event) use ($device, $contact) {
            expect($event->broadcastAs())->toBe('device.revoked')
                ->and(channelNames($event))->toEqualCanonicalizing(["private-user.{$this->me->id}", "private-user.{$contact->id}"])
                ->and(payloadOf($event))->toBe(['user_id' => $this->me->id, 'device_id' => $device->id]);

            return true;
        });
    });

    it('is not sent for someone else\'s device', function () {
        $theirs = makeDevice(User::factory()->create());

        $this->deleteJson("/api/v1/devices/{$theirs->id}")->assertNotFound();

        Event::assertNotDispatched(DeviceRevoked::class);
    });
});

it('is queued for a worker', function () {
    expect(new DeviceAdded(['a' => 1], ['x']))->toBeInstanceOf(ShouldBroadcast::class)
        ->not->toBeInstanceOf(ShouldBroadcastNow::class);
});
