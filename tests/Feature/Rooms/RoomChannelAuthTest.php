<?php

use App\Enums\RoomAdmission;
use App\Models\User;
use Illuminate\Support\Str;

function authorizeRoomChannel($test, string $channel)
{
    return $test->postJson('/api/v1/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $channel]);
}

beforeEach(function () {
    useReverbForChannelAuth();
    $this->host = User::factory()->create();
    $this->room = makeRoom($this->host);
});

it('lets the host and admitted participants join the room channel and shares only id, name and avatar', function () {
    $guest = User::factory()->create(['name' => 'Naw Guest', 'phone' => '+66899999999']);
    addParticipant($this->room, $guest);

    foreach ([$this->host, $guest] as $user) {
        signIn($user);
        $response = authorizeRoomChannel($this, "presence-room.{$this->room->id}")->assertOk()->assertJsonStructure(['auth', 'channel_data']);

        $info = json_decode($response->json('channel_data'), true)['user_info'];
        expect($info)->toBe(['id' => $user->id, 'name' => $user->name, 'avatar_url' => null]);
        expect($response->getContent())->not->toContain($user->email)->not->toContain('+66899999999');
    }
});

it('refuses people who are waiting, denied, or unknown to the room', function (string $case) {
    $user = User::factory()->create();
    match ($case) {
        'waiting' => addParticipant($this->room, $user, ['admission' => RoomAdmission::Waiting]),
        'denied' => addParticipant($this->room, $user, ['admission' => RoomAdmission::Denied]),
        'stranger' => null,
    };
    signIn($user);

    authorizeRoomChannel($this, "presence-room.{$this->room->id}")->assertForbidden();
})->with(['waiting', 'denied', 'stranger']);

it('refuses a room that does not exist or an id that is not a uuid without a server error', function (string $id) {
    signIn();

    authorizeRoomChannel($this, "presence-room.{$id}")->assertForbidden();
})->with([
    'unknown room' => fn () => (string) Str::uuid(),
    'not a uuid' => 'not-a-uuid',
]);

it('stops a removed participant joining the room channel', function () {
    $guest = User::factory()->create();
    $row = addParticipant($this->room, $guest);

    signIn($guest);
    authorizeRoomChannel($this, "presence-room.{$this->room->id}")->assertOk();

    $row->update(['admission' => RoomAdmission::Denied]);
    authorizeRoomChannel($this, "presence-room.{$this->room->id}")->assertForbidden();
});

it('requires a bearer token', function () {
    authorizeRoomChannel($this, "presence-room.{$this->room->id}")->assertUnauthorized();
});
