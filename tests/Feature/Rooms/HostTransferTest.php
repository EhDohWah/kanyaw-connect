<?php

use App\Actions\Rooms\TransferRoomHost;
use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Events\RoomRoleChanged;
use App\Jobs\TransferRoomHostJob;
use App\Models\User;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

function hostLeaves($test, $room, $host)
{
    return sendLiveKitWebhook($test, livekitEvent($room, 'participant_left', $host, ['createdAt' => (string) (now()->timestamp + 5)]))->assertOk();
}

beforeEach(function () {
    fakeLiveKit();
    fakeBroadcasts();
    $this->host = User::factory()->create();
    $this->room = makeRoom($this->host, ['status' => 'active']);
    $this->room->participants()->where('user_id', $this->host->id)->update(['joined_at' => now()->subMinutes(30)]);
});

it('hands the host role to the earliest-joined co-host', function () {
    $laterCoHost = User::factory()->create();
    $earlierCoHost = User::factory()->create();
    $participant = User::factory()->create();
    addParticipant($this->room, $participant, ['joined_at' => now()->subMinutes(25)]); // joined first, but not a co-host
    addParticipant($this->room, $laterCoHost, ['role' => RoomRole::CoHost, 'joined_at' => now()->subMinutes(10)]);
    addParticipant($this->room, $earlierCoHost, ['role' => RoomRole::CoHost, 'joined_at' => now()->subMinutes(20)]);

    hostLeaves($this, $this->room, $this->host);

    $room = $this->room->fresh();
    expect($room->host_id)->toBe($earlierCoHost->id)
        ->and($room->participantFor($earlierCoHost)->role)->toBe(RoomRole::Host)
        ->and($room->participantFor($laterCoHost)->role)->toBe(RoomRole::CoHost)
        ->and($room->participantFor($participant)->role)->toBe(RoomRole::Participant)
        ->and($room->participantFor($this->host)->role)->toBe(RoomRole::Participant);
});

it('falls back to the earliest-joined participant when there is no co-host', function () {
    $later = User::factory()->create();
    $earlier = User::factory()->create();
    addParticipant($this->room, $later, ['joined_at' => now()->subMinutes(5)]);
    addParticipant($this->room, $earlier, ['joined_at' => now()->subMinutes(15)]);

    hostLeaves($this, $this->room, $this->host);

    expect($this->room->fresh()->host_id)->toBe($earlier->id);
});

it('breaks a tie between people who joined in the same second', function () {
    $at = now()->subMinutes(5)->startOfSecond();
    $a = User::factory()->create();
    $b = User::factory()->create();
    $rowA = addParticipant($this->room, $a, ['joined_at' => $at]);
    $rowB = addParticipant($this->room, $b, ['joined_at' => $at]);
    $expected = $rowA->id < $rowB->id ? $a : $b;

    hostLeaves($this, $this->room, $this->host);

    expect($this->room->fresh()->host_id)->toBe($expected->id);
});

it('tells the room who the new host is', function () {
    $successor = User::factory()->create();
    addParticipant($this->room, $successor, ['joined_at' => now()->subMinutes(5)]);

    hostLeaves($this, $this->room, $this->host);

    Event::assertDispatched(RoomRoleChanged::class, function (RoomRoleChanged $event) use ($successor) {
        expect(channelNames($event))->toBe(["presence-room.{$this->room->id}"])
            ->and(payloadOf($event))->toBe([
                'room_id' => $this->room->id,
                'user_id' => $successor->id,
                'role' => 'host',
                'host_id' => $successor->id,
            ]);

        return true;
    });
});

it('gives the new host admin rights on their next token and the old host none', function () {
    $successor = User::factory()->create();
    addParticipant($this->room, $successor, ['joined_at' => now()->subMinutes(5)]);
    hostLeaves($this, $this->room, $this->host);

    signIn($successor);
    $token = $this->postJson("/api/v1/rooms/{$this->room->id}/join")->json('token');
    expect(json_decode(base64_decode(explode('.', $token)[1]), true)['video']['roomAdmin'])->toBeTrue();

    signIn($this->host);
    $token = $this->postJson("/api/v1/rooms/{$this->room->id}/join")->json('token');
    expect(json_decode(base64_decode(explode('.', $token)[1]), true)['video'])->not->toHaveKey('roomAdmin');
});

it('lets the new host use the host controls', function () {
    $successor = User::factory()->create();
    addParticipant($this->room, $successor, ['joined_at' => now()->subMinutes(5)]);
    hostLeaves($this, $this->room, $this->host);

    signIn($successor);
    $this->postJson("/api/v1/rooms/{$this->room->id}/lock")->assertOk();

    signIn($this->host);
    $this->postJson("/api/v1/rooms/{$this->room->id}/unlock")->assertForbidden();
});

it('only considers people who are connected and admitted', function () {
    $left = User::factory()->create();
    $waiting = User::factory()->create();
    $denied = User::factory()->create();
    $neverConnected = User::factory()->create();
    $present = User::factory()->create();
    addParticipant($this->room, $left, ['joined_at' => now()->subMinutes(20), 'left_at' => now()->subMinutes(10)]);
    addParticipant($this->room, $waiting, ['admission' => RoomAdmission::Waiting, 'joined_at' => now()->subMinutes(19)]);
    addParticipant($this->room, $denied, ['admission' => RoomAdmission::Denied, 'joined_at' => now()->subMinutes(18)]);
    addParticipant($this->room, $neverConnected);
    addParticipant($this->room, $present, ['joined_at' => now()->subMinutes(2)]);

    hostLeaves($this, $this->room, $this->host);

    expect($this->room->fresh()->host_id)->toBe($present->id);
});

it('keeps the host when nobody else is in the room', function () {
    hostLeaves($this, $this->room, $this->host);

    expect($this->room->fresh()->host_id)->toBe($this->host->id)
        ->and($this->room->participantFor($this->host)->role)->toBe(RoomRole::Host);
    Event::assertNotDispatched(RoomRoleChanged::class);
});

it('does nothing when an ordinary participant leaves', function () {
    $guest = User::factory()->create();
    addParticipant($this->room, $guest, ['joined_at' => now()->subMinutes(5)]);

    sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_left', $guest, ['createdAt' => (string) (now()->timestamp + 5)]))->assertOk();

    expect($this->room->fresh()->host_id)->toBe($this->host->id);
    Event::assertNotDispatched(RoomRoleChanged::class);
});

it('does not move the host role in a room that has ended', function () {
    addParticipant($this->room, User::factory()->create(), ['joined_at' => now()->subMinutes(5)]);
    $this->room->update(['status' => 'ended', 'ended_at' => now()]);

    hostLeaves($this, $this->room, $this->host);

    expect($this->room->fresh()->host_id)->toBe($this->host->id);
});

describe('with a grace period for unstable connections', function () {
    beforeEach(function () {
        config(['rooms.host_transfer_grace_seconds' => 30]);
        $this->successor = User::factory()->create();
        addParticipant($this->room, $this->successor, ['joined_at' => now()->subMinutes(5)]);
    });

    it('waits before handing the role on', function () {
        Queue::fake();

        hostLeaves($this, $this->room, $this->host);

        expect($this->room->fresh()->host_id)->toBe($this->host->id);
        Queue::assertPushed(TransferRoomHostJob::class, function (TransferRoomHostJob $job) {
            return $job->roomId === $this->room->id
                && $job->previousHostId === $this->host->id
                && $job->delay !== null;
        });
    });

    it('hands it on if the host is still gone when the time is up', function () {
        hostLeaves($this, $this->room, $this->host); // the test queue runs the delayed job straight away

        expect($this->room->fresh()->host_id)->toBe($this->successor->id);
    });

    it('keeps the host if they reconnected in the meantime', function () {
        Queue::fake();
        hostLeaves($this, $this->room, $this->host);
        sendLiveKitWebhook($this, livekitEvent($this->room, 'participant_joined', $this->host, ['createdAt' => (string) (now()->timestamp + 10)]))->assertOk();

        (new TransferRoomHostJob($this->room->id, $this->host->id))->handle(app(TransferRoomHost::class));

        expect($this->room->fresh()->host_id)->toBe($this->host->id)
            ->and($this->room->participantFor($this->host)->role)->toBe(RoomRole::Host);
    });

    it('does nothing if the role already moved on', function () {
        hostLeaves($this, $this->room, $this->host);
        $hostAfter = $this->room->fresh()->host_id;

        (new TransferRoomHostJob($this->room->id, $this->host->id))->handle(app(TransferRoomHost::class));

        expect($this->room->fresh()->host_id)->toBe($hostAfter);
    });

    it('skips a room that no longer exists', function () {
        $job = new TransferRoomHostJob((string) Str::uuid(), $this->host->id);

        $job->handle(app(TransferRoomHost::class));

        expect(true)->toBeTrue();
    });
});
