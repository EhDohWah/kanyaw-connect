<?php

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Models\User;
use Illuminate\Support\Str;

beforeEach(function () {
    fakeLiveKit();
});

it('shows a room to its host with the waiting list', function () {
    $host = signIn();
    $room = makeRoom($host, ['waiting_room_enabled' => true, 'password' => 'secret1']);
    $waiting = User::factory()->create(['phone' => '+66855555555']);
    addParticipant($room, $waiting, ['admission' => RoomAdmission::Waiting]);
    addParticipant($room, User::factory()->create(), ['admission' => RoomAdmission::Admitted]);

    $response = $this->getJson("/api/v1/rooms/{$room->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $room->id)
        ->assertJsonPath('data.has_password', true)
        ->assertJsonPath('data.my_participation.role', 'host')
        ->assertJsonCount(1, 'data.waiting_participants')
        ->assertJsonPath('data.waiting_participants.0.user.id', $waiting->id)
        ->assertJsonPath('data.waiting_participants.0.admission', 'waiting');

    expect($response->getContent())->not->toContain('secret1')->not->toContain($room->livekit_room_name)
        ->not->toContain($waiting->email)->not->toContain('+66855555555');
});

it('shows co-hosts the waiting list but not plain participants', function () {
    $room = makeRoom();
    addParticipant($room, User::factory()->create(), ['admission' => RoomAdmission::Waiting]);
    $coHost = User::factory()->create();
    $guest = User::factory()->create();
    addParticipant($room, $coHost, ['role' => RoomRole::CoHost]);
    addParticipant($room, $guest);

    signIn($coHost);
    $this->getJson("/api/v1/rooms/{$room->id}")->assertJsonCount(1, 'data.waiting_participants');

    signIn($guest);
    $this->getJson("/api/v1/rooms/{$room->id}")->assertOk()->assertJsonMissingPath('data.waiting_participants');
});

it('reports how many people are connected', function () {
    $room = makeRoom();
    addParticipant($room, null, ['joined_at' => now()->subMinute()]);
    addParticipant($room, null, ['joined_at' => now()->subMinutes(5), 'left_at' => now()->subMinute()]);
    addParticipant($room, null); // admitted but never connected
    addParticipant($room, null, ['admission' => RoomAdmission::Waiting, 'joined_at' => now()]); // cannot be connected: not admitted

    signIn($room->host);
    $this->getJson("/api/v1/rooms/{$room->id}")->assertJsonPath('data.present_count', 1);
});

it('lets anyone with the link see a room that is not linked to a chat', function () {
    $room = makeRoom();
    signIn(User::factory()->create());

    $this->getJson("/api/v1/rooms/{$room->id}")
        ->assertOk()
        ->assertJsonPath('data.my_participation', null);
});

it('shows a chat-linked room only to its host, its chat members and people who asked to join', function () {
    $host = User::factory()->create();
    $member = User::factory()->create();
    $chat = makeGroup($host, [$member]);
    $room = makeRoom($host, ['chat_id' => $chat->id]);

    signIn($member);
    $this->getJson("/api/v1/rooms/{$room->id}")->assertOk();

    signIn(User::factory()->create());
    $this->getJson("/api/v1/rooms/{$room->id}")->assertForbidden();
});

it('stops showing a chat-linked room to someone who left the chat', function () {
    $host = User::factory()->create();
    $member = User::factory()->create();
    $chat = makeGroup($host, [$member]);
    $room = makeRoom($host, ['chat_id' => $chat->id]);
    $chat->chatMembers()->where('user_id', $member->id)->delete();

    signIn($member);
    $this->getJson("/api/v1/rooms/{$room->id}")->assertForbidden();
});

it('still shows an ended room', function () {
    $room = makeRoom(null, ['status' => 'ended', 'ended_at' => now()]);
    signIn($room->host);

    $this->getJson("/api/v1/rooms/{$room->id}")->assertOk()->assertJsonPath('data.status', 'ended');
});

it('returns 404 for rooms that do not exist or are deleted, and for ids that are not UUIDs', function () {
    signIn();
    $gone = makeRoom();
    $gone->delete();

    $this->getJson('/api/v1/rooms/'.Str::uuid())->assertNotFound();
    $this->getJson("/api/v1/rooms/{$gone->id}")->assertNotFound();
    $this->getJson('/api/v1/rooms/not-a-uuid')->assertNotFound();
});

it('requires authentication', function () {
    $this->getJson('/api/v1/rooms/'.Str::uuid())->assertUnauthorized();
});
