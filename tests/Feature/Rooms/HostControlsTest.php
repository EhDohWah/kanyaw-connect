<?php

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Events\RoomAdmitted;
use App\Events\RoomDenied;
use App\Events\RoomEnded;
use App\Events\RoomRoleChanged;
use App\Models\Room;
use App\Models\User;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    fakeBroadcasts();
    $this->host = User::factory()->create();
    $this->coHost = User::factory()->create();
    $this->guest = User::factory()->create();
    $this->waiting = User::factory()->create();
    $this->room = makeRoom($this->host, ['waiting_room_enabled' => true, 'status' => 'active']);
    addParticipant($this->room, $this->coHost, ['role' => RoomRole::CoHost, 'joined_at' => now()->subMinutes(3)]);
    addParticipant($this->room, $this->guest, ['joined_at' => now()->subMinutes(2)]);
    addParticipant($this->room, $this->waiting, ['admission' => RoomAdmission::Waiting]);
});

function api($test, string $method, Room $room, string $path)
{
    return $test->json($method, "/api/v1/rooms/{$room->id}/{$path}");
}

describe('admit and deny', function () {
    it('lets the host and co-hosts admit a waiting person, and tells that person', function (string $who) {
        signIn($this->{$who});

        api($this, 'POST', $this->room, "admit/{$this->waiting->id}")
            ->assertOk()
            ->assertJsonPath('data.user.id', $this->waiting->id)
            ->assertJsonPath('data.admission', 'admitted');

        expect($this->room->participants()->where('user_id', $this->waiting->id)->first()->admission)->toBe(RoomAdmission::Admitted);

        Event::assertDispatched(RoomAdmitted::class, function (RoomAdmitted $event) {
            expect($event->broadcastAs())->toBe('room.admitted')
                // Only the waiting person's own channel: they are not on the room channel yet.
                ->and(channelNames($event))->toBe(["private-user.{$this->waiting->id}"])
                ->and(payloadOf($event)['room'])->toMatchArray(['id' => $this->room->id, 'name' => $this->room->name]);
            expect(json_encode($event->broadcastWith()))->not->toContain('password');

            return true;
        });
    })->with(['host', 'coHost']);

    it('lets them deny a waiting person, and tells that person', function (string $who) {
        signIn($this->{$who});

        api($this, 'POST', $this->room, "deny/{$this->waiting->id}")->assertOk()->assertJsonPath('data.admission', 'denied');

        Event::assertDispatched(RoomDenied::class, fn (RoomDenied $e) => channelNames($e) === ["private-user.{$this->waiting->id}"] && $e->broadcastAs() === 'room.denied');
    })->with(['host', 'coHost']);

    it('lets a denied person in after all if the host admits them', function () {
        signIn($this->host);
        api($this, 'POST', $this->room, "deny/{$this->waiting->id}")->assertOk();
        api($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk()->assertJsonPath('data.admission', 'admitted');

        signIn($this->waiting);
        $this->postJson("/api/v1/rooms/{$this->room->id}/join")->assertOk()->assertJsonPath('status', 'admitted');
    });

    it('does nothing the second time someone is admitted', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();
        api($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();

        Event::assertDispatchedTimes(RoomAdmitted::class, 1);
    });

    it('cannot deny someone who is already in the room (use remove)', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, "deny/{$this->guest->id}")->assertStatus(409)->assertJsonPath('code', 'not_waiting');
        expect($this->room->participants()->where('user_id', $this->guest->id)->first()->admission)->toBe(RoomAdmission::Admitted);
    });

    it('is forbidden for plain participants and for people waiting', function (string $who, string $action) {
        signIn($this->{$who});

        api($this, 'POST', $this->room, "{$action}/{$this->waiting->id}")->assertForbidden();
        expect($this->room->participants()->where('user_id', $this->waiting->id)->first()->admission)->toBe(RoomAdmission::Waiting);
        Event::assertNotDispatched(RoomAdmitted::class);
        Event::assertNotDispatched(RoomDenied::class);
    })->with([
        ['guest', 'admit'], ['guest', 'deny'], ['waiting', 'admit'], ['waiting', 'deny'],
    ]);

    it('is forbidden for strangers', function () {
        $this->room->update(['chat_id' => makeGroup($this->host)->id]);
        signIn(User::factory()->create());

        api($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertForbidden();
    });

    it('returns 404 for someone who never asked to join', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, 'admit/'.User::factory()->create()->id)->assertNotFound();
        api($this, 'POST', $this->room, 'deny/'.Str::uuid())->assertNotFound();
    });
});

describe('locking', function () {
    it('lets only the host lock and unlock', function () {
        signIn($this->host);
        api($this, 'POST', $this->room, 'lock')->assertOk()->assertJsonPath('data.is_locked', true);
        expect($this->room->fresh()->is_locked)->toBeTrue();

        api($this, 'POST', $this->room, 'unlock')->assertOk()->assertJsonPath('data.is_locked', false);
        expect($this->room->fresh()->is_locked)->toBeFalse();
    });

    it('forbids co-hosts and participants', function (string $who, string $action) {
        signIn($this->{$who});

        api($this, 'POST', $this->room, $action)->assertForbidden();
        expect($this->room->fresh()->is_locked)->toBeFalse();
    })->with([['coHost', 'lock'], ['guest', 'lock'], ['coHost', 'unlock'], ['guest', 'unlock']]);

    it('cannot lock an ended room', function () {
        $this->room->update(['status' => 'ended', 'ended_at' => now()]);
        signIn($this->host);

        api($this, 'POST', $this->room, 'lock')->assertStatus(409)->assertJsonPath('code', 'room_ended');
    });

    it('keeps new people out while locked', function () {
        signIn($this->host);
        api($this, 'POST', $this->room, 'lock')->assertOk();

        signIn(User::factory()->create());
        $this->postJson("/api/v1/rooms/{$this->room->id}/join")->assertStatus(409)->assertJsonPath('code', 'room_locked');
    });
});

describe('ending', function () {
    it('ends the room, closes it in LiveKit and tells the room', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, 'end')
            ->assertOk()
            ->assertJsonPath('data.status', 'ended');

        $room = $this->room->fresh();
        expect($room->status->value)->toBe('ended')
            ->and($room->ended_at)->not->toBeNull()
            ->and($this->livekit->deleted)->toBe([$room->livekit_room_name]);

        Event::assertDispatched(RoomEnded::class, function (RoomEnded $event) {
            expect($event->broadcastAs())->toBe('room.ended')
                ->and(channelNames($event))->toBe(["presence-room.{$this->room->id}"])
                ->and(payloadOf($event)['room_id'])->toBe($this->room->id)
                ->and(payloadOf($event)['ended_at'])->not->toBeNull();

            return true;
        });
    });

    it('marks everyone who was connected as having left', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, 'end')->assertOk();

        $connected = $this->room->participants()->whereNotNull('joined_at')->get();
        expect($connected)->not->toBeEmpty()->and($connected->every(fn ($p) => $p->left_at !== null))->toBeTrue();
    });

    it('refuses joins afterwards', function () {
        signIn($this->host);
        api($this, 'POST', $this->room, 'end')->assertOk();

        signIn($this->guest);
        $this->postJson("/api/v1/rooms/{$this->room->id}/join")->assertStatus(409)->assertJsonPath('code', 'room_ended');
    });

    it('does nothing the second time', function () {
        signIn($this->host);
        api($this, 'POST', $this->room, 'end')->assertOk();
        api($this, 'POST', $this->room, 'end')->assertOk()->assertJsonPath('data.status', 'ended');

        expect($this->livekit->deleted)->toHaveCount(1);
        Event::assertDispatchedTimes(RoomEnded::class, 1);
    });

    it('leaves the room open when LiveKit cannot be reached, so the host can retry', function () {
        $this->livekit->down = true;
        signIn($this->host);

        api($this, 'POST', $this->room, 'end')->assertStatus(503);

        expect($this->room->fresh()->status->value)->toBe('active');
        Event::assertNotDispatched(RoomEnded::class);
    });

    it('is host only', function (string $who) {
        signIn($this->{$who});

        api($this, 'POST', $this->room, 'end')->assertForbidden();
        expect($this->room->fresh()->status->value)->toBe('active')->and($this->livekit->deleted)->toBe([]);
    })->with(['coHost', 'guest', 'waiting']);
});

describe('removing people', function () {
    it('puts someone out and stops them coming back', function (string $who) {
        signIn($this->{$who});

        api($this, 'POST', $this->room, "participants/{$this->guest->id}/remove")->assertNoContent();

        $row = $this->room->participants()->where('user_id', $this->guest->id)->first();
        expect($row->admission)->toBe(RoomAdmission::Denied)
            ->and($this->livekit->removed)->toBe([['room' => $this->room->livekit_room_name, 'user' => $this->guest->id]]);

        Event::assertDispatched(RoomDenied::class, fn ($e) => channelNames($e) === ["private-user.{$this->guest->id}"]);

        signIn($this->guest);
        $this->postJson("/api/v1/rooms/{$this->room->id}/join")->assertForbidden();
    })->with(['host', 'coHost']);

    it('still blocks them if LiveKit is unreachable, and tells the host to retry', function () {
        $this->livekit->down = true;
        signIn($this->host);

        api($this, 'POST', $this->room, "participants/{$this->guest->id}/remove")->assertStatus(503);

        expect($this->room->participants()->where('user_id', $this->guest->id)->first()->admission)->toBe(RoomAdmission::Denied);
    });

    it('lets the host remove a co-host, but a co-host cannot remove the host or another co-host', function () {
        $otherCoHost = User::factory()->create();
        addParticipant($this->room, $otherCoHost, ['role' => RoomRole::CoHost]);

        signIn($this->coHost);
        api($this, 'POST', $this->room, "participants/{$this->host->id}/remove")->assertForbidden();
        api($this, 'POST', $this->room, "participants/{$otherCoHost->id}/remove")->assertForbidden();

        signIn($this->host);
        api($this, 'POST', $this->room, "participants/{$otherCoHost->id}/remove")->assertNoContent();
    });

    it('does not let anyone remove themselves', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, "participants/{$this->host->id}/remove")->assertForbidden();
        expect($this->livekit->removed)->toBe([]);
    });

    it('is forbidden for plain participants', function () {
        signIn($this->guest);

        api($this, 'POST', $this->room, "participants/{$this->coHost->id}/remove")->assertForbidden();
        expect($this->livekit->removed)->toBe([]);
    });

    it('returns 404 for someone who is not in the room', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, 'participants/'.User::factory()->create()->id.'/remove')->assertNotFound();
    });
});

describe('muting people', function () {
    it('mutes the microphone of a connected participant', function (string $who) {
        $this->livekit->connected[$this->guest->id] = 1;
        signIn($this->{$who});

        api($this, 'POST', $this->room, "participants/{$this->guest->id}/mute")
            ->assertOk()
            ->assertJsonPath('data.muted_tracks', 1);

        expect($this->livekit->muted)->toBe([['room' => $this->room->livekit_room_name, 'user' => $this->guest->id, 'kind' => 'audio']]);
    })->with(['host', 'coHost']);

    it('can mute the camera instead', function () {
        $this->livekit->connected[$this->guest->id] = 1;
        signIn($this->host);

        $this->postJson("/api/v1/rooms/{$this->room->id}/participants/{$this->guest->id}/mute", ['kind' => 'video'])->assertOk();

        expect($this->livekit->muted[0]['kind'])->toBe('video');
    });

    it('rejects an unknown kind', function () {
        $this->livekit->connected[$this->guest->id] = 1;
        signIn($this->host);

        $this->postJson("/api/v1/rooms/{$this->room->id}/participants/{$this->guest->id}/mute", ['kind' => 'screen'])
            ->assertUnprocessable()->assertJsonValidationErrors('kind');
    });

    it('says so when the person is not in the call', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, "participants/{$this->guest->id}/mute")->assertStatus(409)->assertJsonPath('code', 'participant_not_connected');
    });

    it('does not let a co-host mute the host, and nobody mute themselves', function () {
        $this->livekit->connected[$this->host->id] = 1;
        $this->livekit->connected[$this->coHost->id] = 1;

        signIn($this->coHost);
        api($this, 'POST', $this->room, "participants/{$this->host->id}/mute")->assertForbidden();
        api($this, 'POST', $this->room, "participants/{$this->coHost->id}/mute")->assertForbidden();
        expect($this->livekit->muted)->toBe([]);
    });

    it('is forbidden for plain participants', function () {
        $this->livekit->connected[$this->coHost->id] = 1;
        signIn($this->guest);

        api($this, 'POST', $this->room, "participants/{$this->coHost->id}/mute")->assertForbidden();
    });

    it('answers 503 when LiveKit is down', function () {
        $this->livekit->down = true;
        signIn($this->host);

        api($this, 'POST', $this->room, "participants/{$this->guest->id}/mute")->assertStatus(503);
    });
});

describe('co-hosts', function () {
    it('lets the host appoint a co-host and tells the room', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, "co-hosts/{$this->guest->id}")
            ->assertOk()
            ->assertJsonPath('data.role', 'co_host');

        expect($this->room->participants()->where('user_id', $this->guest->id)->first()->role)->toBe(RoomRole::CoHost);

        Event::assertDispatched(RoomRoleChanged::class, function (RoomRoleChanged $event) {
            expect($event->broadcastAs())->toBe('room.role_changed')
                ->and(channelNames($event))->toBe(["presence-room.{$this->room->id}"])
                ->and(payloadOf($event))->toBe([
                    'room_id' => $this->room->id,
                    'user_id' => $this->guest->id,
                    'role' => 'co_host',
                    'host_id' => $this->host->id,
                ]);

            return true;
        });
    });

    it('gives the new co-host powers straight away', function () {
        signIn($this->host);
        api($this, 'POST', $this->room, "co-hosts/{$this->guest->id}")->assertOk();

        signIn($this->guest);
        api($this, 'POST', $this->room, "admit/{$this->waiting->id}")->assertOk();
    });

    it('is host only', function (string $who) {
        signIn($this->{$who});

        api($this, 'POST', $this->room, "co-hosts/{$this->guest->id}")->assertForbidden();
        expect($this->room->participants()->where('user_id', $this->guest->id)->first()->role)->toBe(RoomRole::Participant);
    })->with(['coHost', 'guest']);

    it('does not announce it twice', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, "co-hosts/{$this->guest->id}")->assertOk();
        api($this, 'POST', $this->room, "co-hosts/{$this->guest->id}")->assertOk();

        Event::assertDispatchedTimes(RoomRoleChanged::class, 1);
    });

    it('needs the person to be in the room and admitted', function () {
        signIn($this->host);

        api($this, 'POST', $this->room, 'co-hosts/'.User::factory()->create()->id)->assertNotFound();
        api($this, 'POST', $this->room, "co-hosts/{$this->waiting->id}")->assertNotFound();
    });
});

it('requires authentication for every control', function (string $path) {
    $this->app['auth']->forgetGuards();
    $id = Str::uuid();

    $this->withHeader('Authorization', '')->postJson("/api/v1/rooms/{$id}/".str_replace('{user}', $id, $path))->assertUnauthorized();
})->with(['admit/{user}', 'deny/{user}', 'lock', 'unlock', 'end', 'participants/{user}/remove', 'participants/{user}/mute', 'co-hosts/{user}']);
