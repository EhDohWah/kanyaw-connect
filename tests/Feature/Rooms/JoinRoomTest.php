<?php

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Events\RoomJoinRequested;
use App\Models\Room;
use App\Models\User;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Support\Str;

/** Decode a LiveKit token the way LiveKit would, with our API secret. */
function decodeToken(string $token): object
{
    return JWT::decode($token, new Key(config('services.livekit.api_secret'), 'HS256'));
}

function join_($test, Room $room, array $body = [])
{
    return $test->postJson("/api/v1/rooms/{$room->id}/join", $body);
}

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    $this->host = User::factory()->create(['name' => 'Saw Host']);
    $this->room = makeRoom($this->host, ['max_participants' => 5]);
});

describe('the token', function () {
    it('lets the host in with admin rights', function () {
        signIn($this->host);

        $response = join_($this, $this->room)
            ->assertOk()
            ->assertJsonPath('status', 'admitted')
            ->assertJsonPath('livekit_url', 'ws://livekit.test:7880')
            ->assertJsonPath('room.id', $this->room->id)
            ->assertJsonPath('room.my_participation.role', 'host');

        $jwt = decodeToken($response->json('token'));
        expect($jwt->sub)->toBe($this->host->id)
            ->and($jwt->iss)->toBe('test-api-key')
            ->and($jwt->name)->toBe('Saw Host')
            ->and($jwt->video->room)->toBe($this->room->livekit_room_name)
            ->and($jwt->video->roomJoin)->toBeTrue()
            ->and($jwt->video->roomAdmin)->toBeTrue()
            ->and($jwt->video->canPublish)->toBeTrue()
            ->and($jwt->video->canSubscribe)->toBeTrue()
            ->and(json_decode($jwt->metadata, true))->toBe(['role' => 'host', 'avatar_url' => null]);
    });

    it('gives participants no admin rights', function () {
        $guest = signIn();

        $jwt = decodeToken(join_($this, $this->room)->assertOk()->json('token'));

        expect($jwt->sub)->toBe($guest->id)
            ->and($jwt->video->roomJoin)->toBeTrue()
            ->and(property_exists($jwt->video, 'roomAdmin'))->toBeFalse()
            ->and(json_decode($jwt->metadata, true)['role'])->toBe('participant');
    });

    it('gives co-hosts admin rights', function () {
        $coHost = signIn();
        addParticipant($this->room, $coHost, ['role' => RoomRole::CoHost]);

        $jwt = decodeToken(join_($this, $this->room)->json('token'));

        expect($jwt->video->roomAdmin)->toBeTrue()
            ->and(json_decode($jwt->metadata, true)['role'])->toBe('co_host');
    });

    it('lasts one hour by default and follows the configured lifetime', function () {
        signIn();

        $jwt = decodeToken(join_($this, $this->room)->json('token'));
        expect($jwt->exp - $jwt->nbf)->toBe(3600);

        config(['services.livekit.token_ttl' => 600]);
        fakeLiveKit();
        $jwt = decodeToken(join_($this, $this->room)->json('token'));
        expect($jwt->exp - $jwt->nbf)->toBe(600);
    });

    it('carries the avatar in the token metadata', function () {
        $guest = signIn(User::factory()->create(['avatar_path' => 'avatars/x/a.png']));

        $meta = json_decode(decodeToken(join_($this, $this->room)->json('token'))->metadata, true);

        expect($meta['avatar_url'])->toContain('avatars/x/a_256.webp');
    });

    it('is not usable for another room', function () {
        signIn();
        $otherRoom = makeRoom();

        $a = decodeToken(join_($this, $this->room)->json('token'));
        $b = decodeToken(join_($this, $otherRoom)->json('token'));

        expect($a->video->room)->not->toBe($b->video->room);
    });
});

describe('starting the LiveKit room', function () {
    it('creates it with the first token, and not again once the room is active', function () {
        signIn($this->host);
        join_($this, $this->room)->assertOk();
        expect($this->livekit->created)->toBe([$this->room->livekit_room_name]);

        $this->room->update(['status' => 'active']);
        join_($this, $this->room)->assertOk();
        expect($this->livekit->created)->toHaveCount(1);
    });

    it('does not create it when the person is only put in the waiting room', function () {
        $this->room->update(['waiting_room_enabled' => true]);
        signIn();

        join_($this, $this->room)->assertOk()->assertJsonPath('status', 'waiting');

        expect($this->livekit->created)->toBe([]);
    });

    it('answers 503 when LiveKit is down, and issues no token', function () {
        $this->livekit->down = true;
        signIn($this->host);

        join_($this, $this->room)->assertStatus(503)->assertJsonStructure(['message']);
    });
});

describe('ended, locked and denied rooms', function () {
    it('rejects joins to an ended room', function () {
        $this->room->update(['status' => 'ended', 'ended_at' => now()]);

        signIn($this->host);
        join_($this, $this->room)->assertStatus(409)->assertJsonPath('code', 'room_ended')->assertJsonMissingPath('token');

        signIn();
        join_($this, $this->room)->assertStatus(409)->assertJsonPath('code', 'room_ended');
        expect($this->livekit->created)->toBe([]);
    });

    it('turns new people away from a locked room but lets admitted ones back in', function () {
        $this->room->update(['is_locked' => true]);
        $regular = User::factory()->create();
        addParticipant($this->room, $regular);

        signIn();
        join_($this, $this->room)->assertStatus(409)->assertJsonPath('code', 'room_locked');

        signIn($regular);
        join_($this, $this->room)->assertOk()->assertJsonPath('status', 'admitted');

        signIn($this->host);
        join_($this, $this->room)->assertOk();
    });

    it('does not create a participant row for someone turned away', function () {
        $this->room->update(['is_locked' => true]);
        $stranger = signIn();

        join_($this, $this->room)->assertStatus(409);

        expect($this->room->participants()->where('user_id', $stranger->id)->exists())->toBeFalse();
    });

    it('refuses someone the host denied', function () {
        $denied = User::factory()->create();
        addParticipant($this->room, $denied, ['admission' => RoomAdmission::Denied]);

        signIn($denied);
        join_($this, $this->room)->assertForbidden();
        expect($this->livekit->created)->toBe([]);
    });
});

describe('the password', function () {
    beforeEach(function () {
        $this->room->update(['password' => 'open-sesame']);
    });

    it('is required from newcomers', function () {
        signIn();

        join_($this, $this->room)->assertUnprocessable()->assertJsonValidationErrors('password');
        join_($this, $this->room, ['password' => ''])->assertUnprocessable()->assertJsonValidationErrors('password');
    });

    it('must be right', function () {
        $guest = signIn();

        join_($this, $this->room, ['password' => 'wrong'])->assertUnprocessable()->assertJsonValidationErrors('password');
        expect($this->room->participants()->where('user_id', $guest->id)->exists())->toBeFalse();
    });

    it('lets people in when it is right', function () {
        signIn();

        join_($this, $this->room, ['password' => 'open-sesame'])->assertOk()->assertJsonPath('status', 'admitted');
    });

    it('is not asked of the host', function () {
        signIn($this->host);

        join_($this, $this->room)->assertOk();
    });

    it('is not asked again once someone is admitted, so reconnecting needs no password', function () {
        $guest = signIn();
        join_($this, $this->room, ['password' => 'open-sesame'])->assertOk();

        join_($this, $this->room)->assertOk()->assertJsonPath('status', 'admitted');
    });

    it('is checked before anyone joins the waiting room', function () {
        $this->room->update(['waiting_room_enabled' => true]);
        $guest = signIn();

        join_($this, $this->room)->assertUnprocessable();
        join_($this, $this->room, ['password' => 'nope'])->assertUnprocessable();
        expect($this->room->participants()->where('user_id', $guest->id)->exists())->toBeFalse();

        join_($this, $this->room, ['password' => 'open-sesame'])->assertOk()->assertJsonPath('status', 'waiting');
    });

    it('is not required by a room without one', function () {
        $this->room->update(['password' => null]);
        signIn();

        join_($this, $this->room)->assertOk();
    });

    it('cannot be tried more than 20 times a minute', function () {
        signIn();

        foreach (range(1, 20) as $_) {
            join_($this, $this->room, ['password' => 'guess'])->assertUnprocessable();
        }

        join_($this, $this->room, ['password' => 'open-sesame'])->assertTooManyRequests();
    });
});

describe('the waiting room', function () {
    beforeEach(function () {
        $this->room->update(['waiting_room_enabled' => true]);
    });

    it('holds newcomers until the host lets them in', function () {
        $guest = signIn();

        join_($this, $this->room)
            ->assertOk()
            ->assertExactJson(['status' => 'waiting']);

        $row = $this->room->participants()->where('user_id', $guest->id)->sole();
        expect($row->admission)->toBe(RoomAdmission::Waiting)->and($row->token_issued_at)->toBeNull();
    });

    it('keeps them waiting when they ask again', function () {
        signIn();

        join_($this, $this->room)->assertJsonPath('status', 'waiting');
        join_($this, $this->room)->assertJsonPath('status', 'waiting');

        expect($this->room->participants()->count())->toBe(2); // host + guest
    });

    it('does not make the host wait', function () {
        signIn($this->host);

        join_($this, $this->room)->assertJsonPath('status', 'admitted');
    });

    it('does not make a co-host wait', function () {
        $coHost = signIn();
        addParticipant($this->room, $coHost, ['role' => RoomRole::CoHost]);

        join_($this, $this->room)->assertJsonPath('status', 'admitted');
    });

    it('lets someone in once admitted, when they ask again', function () {
        $guest = signIn();
        join_($this, $this->room)->assertJsonPath('status', 'waiting');

        $this->room->participants()->where('user_id', $guest->id)->update(['admission' => RoomAdmission::Admitted]);

        join_($this, $this->room)->assertJsonPath('status', 'admitted')->assertJsonStructure(['token']);
    });

    it('lets waiting people straight in if the host switches the waiting room off', function () {
        signIn();
        join_($this, $this->room)->assertJsonPath('status', 'waiting');

        $this->room->update(['waiting_room_enabled' => false]);

        join_($this, $this->room)->assertJsonPath('status', 'admitted');
    });

    it('tells the host and co-hosts that someone is waiting', function () {
        fakeBroadcasts();
        $coHost = User::factory()->create();
        addParticipant($this->room, $coHost, ['role' => RoomRole::CoHost]);
        addParticipant($this->room, User::factory()->create()); // a plain participant: not told
        $guest = signIn(User::factory()->create(['phone' => '+66866666666']));

        join_($this, $this->room)->assertJsonPath('status', 'waiting');

        Event::assertDispatchedTimes(RoomJoinRequested::class, 1);
        Event::assertDispatched(RoomJoinRequested::class, function (RoomJoinRequested $event) use ($coHost, $guest) {
            expect($event->broadcastAs())->toBe('room.join_requested')
                ->and(channelNames($event))->toEqualCanonicalizing([
                    "presence-room.{$this->room->id}",
                    "private-user.{$this->host->id}",
                    "private-user.{$coHost->id}",
                ])
                ->and(payloadOf($event))->toBe([
                    'room_id' => $this->room->id,
                    'user' => ['id' => $guest->id, 'name' => $guest->name, 'avatar_url' => null, 'avatar_thumb_url' => null],
                ]);
            expect(json_encode($event->broadcastWith()))->not->toContain($guest->email)->not->toContain('+66866666666');

            return true;
        });
    });

    it('tells the host once, not every time the person asks again', function () {
        fakeBroadcasts();
        signIn();

        join_($this, $this->room);
        join_($this, $this->room);
        join_($this, $this->room);

        Event::assertDispatchedTimes(RoomJoinRequested::class, 1);
    });
});

describe('capacity', function () {
    beforeEach(function () {
        $this->room->update(['max_participants' => 3]);
        // Two people are connected: the host and one guest. One seat is left (max - 1 taken).
        $this->room->participants()->where('user_id', $this->host->id)->update(['joined_at' => now()->subMinutes(5)]);
        addParticipant($this->room, null, ['joined_at' => now()->subMinutes(4)]);
    });

    it('admits the last seat and refuses the next person', function () {
        $first = signIn();
        join_($this, $this->room)->assertOk()->assertJsonPath('status', 'admitted');

        // The first person has a token but has not connected to LiveKit yet. Their seat is held.
        signIn();
        join_($this, $this->room)->assertStatus(409)->assertJsonPath('code', 'room_full')->assertJsonMissingPath('token');

        expect($this->room->seatsTakenExcept(User::factory()->create()))->toBe(3);
    });

    it('does not count a refused person as a participant', function () {
        signIn();
        join_($this, $this->room)->assertOk();
        $refused = signIn();
        join_($this, $this->room)->assertStatus(409);

        $row = $this->room->participants()->where('user_id', $refused->id)->first();
        expect($row?->token_issued_at)->toBeNull();
    });

    it('releases the held seat if the person never connects', function () {
        signIn();
        join_($this, $this->room)->assertOk();

        $this->travel(config('rooms.seat_hold_seconds') + 1)->seconds();

        signIn();
        join_($this, $this->room)->assertOk()->assertJsonPath('status', 'admitted');
    });

    it('keeps the seat while the person is connected, however long that takes', function () {
        $first = signIn();
        join_($this, $this->room)->assertOk();
        // The webhook reports them connected.
        $this->room->participants()->where('user_id', $first->id)->update(['joined_at' => now(), 'token_issued_at' => null]);

        $this->travel(2)->hours();

        signIn();
        join_($this, $this->room)->assertStatus(409)->assertJsonPath('code', 'room_full');
    });

    it('frees the seat when the person leaves', function () {
        $first = signIn();
        join_($this, $this->room)->assertOk();
        $this->room->participants()->where('user_id', $first->id)->update(['joined_at' => now()->subMinute(), 'token_issued_at' => null]);

        signIn();
        join_($this, $this->room)->assertStatus(409);

        $this->room->participants()->where('user_id', $first->id)->update(['left_at' => now()]);

        join_($this, $this->room)->assertOk();
    });

    it('always lets someone who already holds a seat reconnect', function () {
        $first = signIn();
        join_($this, $this->room)->assertOk();
        signIn();
        join_($this, $this->room)->assertStatus(409); // full

        signIn($first);
        join_($this, $this->room)->assertOk()->assertJsonPath('status', 'admitted');
    });

    it('counts only admitted people', function () {
        addParticipant($this->room, null, ['admission' => RoomAdmission::Waiting, 'joined_at' => now()]);
        addParticipant($this->room, null, ['admission' => RoomAdmission::Denied, 'token_issued_at' => now()]);

        signIn();
        join_($this, $this->room)->assertOk();
    });

    it('applies to the host as well', function () {
        $this->room->participants()->where('user_id', $this->host->id)->update(['joined_at' => null]);
        addParticipant($this->room, null, ['joined_at' => now()]);
        // Full with two guests plus one more connected below.
        addParticipant($this->room, null, ['joined_at' => now()]);

        signIn($this->host);
        // Three others are connected; the host's own seat is free but the room is at 3.
        join_($this, $this->room)->assertStatus(409)->assertJsonPath('code', 'room_full');
    });

    it('takes turns under a lock on the room', function () {
        signIn();

        $queries = collect();
        DB::listen(fn ($q) => $queries->push($q->sql));
        join_($this, $this->room)->assertOk();

        expect($queries->filter(fn ($sql) => str_contains($sql, 'for update') && str_contains($sql, '"rooms"')))->not->toBeEmpty();
    });

    it('does not apply to people only waiting to be let in', function () {
        $this->room->update(['waiting_room_enabled' => true]);
        $this->room->participants()->where('user_id', $this->host->id)->update(['joined_at' => now()]);

        signIn();
        join_($this, $this->room)->assertJsonPath('status', 'waiting');
    });
});

describe('who may join', function () {
    it('lets anyone with the link join a room that is not linked to a chat', function () {
        signIn(User::factory()->create());

        join_($this, $this->room)->assertOk();
    });

    it('lets members of the linked chat join and nobody else', function () {
        $member = User::factory()->create();
        $chat = makeGroup($this->host, [$member]);
        $room = makeRoom($this->host, ['chat_id' => $chat->id]);

        signIn($member);
        join_($this, $room)->assertOk();

        signIn(User::factory()->create());
        join_($this, $room)->assertForbidden();
        expect($room->participants()->count())->toBe(2); // host + member only
    });

    it('returns 404 for a room that does not exist', function () {
        signIn();

        $this->postJson('/api/v1/rooms/'.Str::uuid().'/join')->assertNotFound();
    });

    it('requires authentication', function () {
        $this->app['auth']->forgetGuards();
        $this->withHeader('Authorization', '')->postJson("/api/v1/rooms/{$this->room->id}/join")->assertUnauthorized();
    });
});
