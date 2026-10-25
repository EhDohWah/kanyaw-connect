<?php

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Enums\RoomStatus;
use App\Events\CallAccepted;
use App\Events\CallDeclined;
use App\Events\CallEnded;
use App\Events\CallMissed;
use App\Events\RoomEnded;
use App\Models\Call;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    fakeBroadcasts();
    fakeWebPush();
    $this->caller = User::factory()->create();
    $this->callee = User::factory()->create();
    $this->stranger = User::factory()->create();
});

function ongoingCall(User $caller, User $callee, array $attributes = []): Call
{
    return makeCall($caller, $callee, array_merge(['status' => 'ongoing', 'answered_at' => now()->subMinute()], $attributes));
}

/** The call as the API shows it in a 409 body. */
function conflictBodyFor(Call $call): array
{
    return ['id' => $call->id, 'status' => $call->fresh()->status->value];
}

describe('GET /calls/{call}', function () {
    it('shows the call to both people', function () {
        $call = makeCall($this->caller, $this->callee);

        foreach ([$this->caller, $this->callee] as $person) {
            signIn($person);
            $this->getJson("/api/v1/calls/{$call->id}")->assertOk()->assertJsonPath('data.id', $call->id)->assertJsonPath('data.status', 'ringing');
        }
    });

    it('is a 404 for anyone else, as if there were no such call', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->stranger);

        $this->getJson("/api/v1/calls/{$call->id}")->assertNotFound()->assertJsonPath('message', 'Not found.');
        $this->getJson('/api/v1/calls/'.Str::uuid())->assertNotFound()->assertJsonPath('message', 'Not found.');
    });

    it('needs a signed-in user', function () {
        $call = makeCall($this->caller, $this->callee);

        $this->getJson("/api/v1/calls/{$call->id}")->assertUnauthorized();
    });

    it('gives the duration once an answered call has ended', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ended', 'end_reason' => 'hung_up', 'answered_at' => now()->subSeconds(192), 'ended_at' => now()]);
        signIn($this->caller);

        $this->getJson("/api/v1/calls/{$call->id}")->assertOk()->assertJsonPath('data.duration_seconds', 192)->assertJsonPath('data.end_reason', 'hung_up');
    });
});

describe('GET /calls/current', function () {
    it('is null when there is no call', function () {
        signIn($this->caller);

        $this->getJson('/api/v1/calls/current')->assertOk()->assertExactJson(['data' => null]);
    });

    it('gives a ringing call to both people', function () {
        $call = makeCall($this->caller, $this->callee);

        foreach ([$this->caller, $this->callee] as $person) {
            signIn($person);
            $this->getJson('/api/v1/calls/current')->assertOk()->assertJsonPath('data.id', $call->id);
        }
    });

    it('gives an ongoing call', function () {
        $call = ongoingCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->getJson('/api/v1/calls/current')->assertOk()->assertJsonPath('data.id', $call->id)->assertJsonPath('data.status', 'ongoing');
    });

    it('does not give calls that are over, or other people\'s calls', function () {
        makeCall($this->caller, $this->callee, ['status' => 'declined', 'ended_at' => now()]);
        makeCall($this->stranger, User::factory()->create());
        signIn($this->caller);

        $this->getJson('/api/v1/calls/current')->assertOk()->assertExactJson(['data' => null]);
    });

    it('does not show a call that rang out as still ringing', function () {
        $call = makeCall($this->caller, $this->callee, ['ring_expires_at' => now()->subSecond()]);
        signIn($this->callee);

        $this->getJson('/api/v1/calls/current')->assertOk()->assertExactJson(['data' => null]);
        expect($call->fresh()->status)->toBe(CallStatus::Missed);
    });

    it('needs a signed-in user', function () {
        $this->getJson('/api/v1/calls/current')->assertUnauthorized();
    });
});

describe('POST /calls/{call}/accept', function () {
    it('lets the callee answer: the call is ongoing from now', function () {
        $this->freezeTime();
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertOk()
            ->assertJsonPath('data.status', 'ongoing')
            ->assertJsonPath('data.answered_at', now()->toJSON());

        expect($call->fresh()->status)->toBe(CallStatus::Ongoing);
    });

    it('tells both people, so the callee\'s other devices stop ringing', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertOk();

        Event::assertDispatched(CallAccepted::class, fn (CallAccepted $event) => channelNames($event) === ["private-user.{$this->caller->id}", "private-user.{$this->callee->id}"]
            && $event->broadcastAs() === 'call.accepted'
            && payloadOf($event)['call']['status'] === 'ongoing');
    });

    it('returns the call again when it was already answered (on another device)', function () {
        $call = ongoingCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertOk()->assertJsonPath('data.status', 'ongoing');
        Event::assertNotDispatched(CallAccepted::class);
    });

    it('refuses the caller', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertForbidden()->assertJsonPath('message', 'Only the person being called can answer or decline.');
    });

    it('is a 404 for anyone else', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->stranger);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertNotFound();
    });

    it('needs a signed-in user', function () {
        $call = makeCall($this->caller, $this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertUnauthorized();
    });

    it('refuses with call_not_ringing, and the call, once it was declined, cancelled or missed', function (string $status, ?string $reason) {
        $call = makeCall($this->caller, $this->callee, ['status' => $status, 'end_reason' => $reason, 'ended_at' => now()]);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertConflict()
            ->assertJson(['code' => 'call_not_ringing', 'message' => 'This call is no longer ringing.', 'call' => ['id' => $call->id, 'status' => $status]]);
    })->with([['declined', null], ['missed', 'cancelled'], ['missed', 'no_answer']]);

    it('refuses an answer that comes after the ringing ran out, and records the miss', function () {
        $call = makeCall($this->caller, $this->callee, ['ring_expires_at' => now()->subSecond()]);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/accept")->assertConflict()
            ->assertJsonPath('code', 'call_not_ringing')
            ->assertJsonPath('call.status', 'missed')
            ->assertJsonPath('call.end_reason', 'no_answer');

        expect($call->fresh()->status)->toBe(CallStatus::Missed);
        Event::assertDispatched(CallMissed::class);
    });
});

describe('POST /calls/{call}/decline', function () {
    it('lets the callee say no: the call is declined and its room closed', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk()
            ->assertJsonPath('data.status', 'declined')
            ->assertJsonPath('data.end_reason', null)
            ->assertJsonPath('data.duration_seconds', null);

        expect($call->room->fresh()->status)->toBe(RoomStatus::Ended)
            ->and($this->livekit->deleted)->toBe([$call->room->livekit_room_name]);
        Event::assertDispatched(CallDeclined::class, fn (CallDeclined $event) => channelNames($event) === ["private-user.{$this->caller->id}", "private-user.{$this->callee->id}"]
            && $event->broadcastAs() === 'call.declined');
        Event::assertDispatched(RoomEnded::class);
    });

    it('returns the call again when it was already declined', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'declined', 'ended_at' => now()]);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk()->assertJsonPath('data.status', 'declined');
        Event::assertNotDispatched(CallDeclined::class);
    });

    it('counts a "no" that comes after the ringing ran out as a missed call', function () {
        $call = makeCall($this->caller, $this->callee, ['ring_expires_at' => now()->subSecond()]);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertConflict()
            ->assertJsonPath('code', 'call_not_ringing')
            ->assertJsonPath('call.status', 'missed')
            ->assertJsonPath('call.end_reason', 'no_answer');
    });

    it('refuses with call_not_ringing once it was answered or cancelled', function (string $status) {
        $call = makeCall($this->caller, $this->callee, ['status' => $status, 'answered_at' => $status === 'ongoing' ? now() : null, 'end_reason' => $status === 'missed' ? 'cancelled' : null]);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertConflict()->assertJsonPath('code', 'call_not_ringing')->assertJsonPath('call.status', $status);
    })->with(['ongoing', 'missed']);

    it('refuses the caller', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertForbidden();
        expect($call->fresh()->status)->toBe(CallStatus::Ringing);
    });

    it('is a 404 for anyone else', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->stranger);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertNotFound();
    });

    it('needs a signed-in user or a signed link', function () {
        $call = makeCall($this->caller, $this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertUnauthorized();
        expect($call->fresh()->status)->toBe(CallStatus::Ringing);
    });

    it('still declines when LiveKit cannot be reached', function () {
        $this->livekit->down = true;
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk()->assertJsonPath('data.status', 'declined');
        expect($call->room->fresh()->status)->toBe(RoomStatus::Ended);
    });

    describe('with the signed link from the push (the service worker has no token)', function () {
        it('declines without a token', function () {
            $call = makeCall($this->caller, $this->callee);
            $url = URL::temporarySignedRoute('calls.decline', $call->ring_expires_at, $call);

            $this->postJson($url)->assertOk()->assertJsonPath('data.status', 'declined');
            expect($call->fresh()->status)->toBe(CallStatus::Declined);
        });

        it('stops working when the ringing ends', function () {
            $call = makeCall($this->caller, $this->callee);
            $url = URL::temporarySignedRoute('calls.decline', $call->ring_expires_at, $call);

            $this->travelTo($call->ring_expires_at->addSecond());

            $this->postJson($url)->assertForbidden();
            expect($call->fresh()->status)->toBe(CallStatus::Ringing);
        });

        it('refuses a link that was changed', function (string $change) {
            $call = makeCall($this->caller, $this->callee);
            $other = makeCall($this->stranger, User::factory()->create());
            $url = URL::temporarySignedRoute('calls.decline', $call->ring_expires_at, $call);

            $tampered = match ($change) {
                'another call' => str_replace($call->id, $other->id, $url),
                'later expiry' => preg_replace('/expires=(\d+)/', 'expires='.($call->ring_expires_at->timestamp + 3600), $url),
                'signature' => preg_replace('/signature=([0-9a-f])/', 'signature=0', $url),
            };

            $this->postJson($tampered)->assertForbidden();
            expect($call->fresh()->status)->toBe(CallStatus::Ringing)->and($other->fresh()->status)->toBe(CallStatus::Ringing);
        })->with(['another call', 'later expiry', 'signature']);

        it('refuses a broken signature even with a token alongside', function () {
            $call = makeCall($this->caller, $this->callee);
            signIn($this->callee);

            $this->postJson("/api/v1/calls/{$call->id}/decline?expires=".now()->addMinute()->timestamp.'&signature=nope')->assertForbidden();
        });
    });
});

describe('POST /calls/{call}/cancel', function () {
    it('lets the caller give up before it is answered: missed, cancelled', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk()
            ->assertJsonPath('data.status', 'missed')
            ->assertJsonPath('data.end_reason', 'cancelled');

        expect($call->room->fresh()->status)->toBe(RoomStatus::Ended);
        Event::assertDispatched(CallMissed::class, fn (CallMissed $event) => $event->broadcastAs() === 'call.missed' && count(channelNames($event)) === 2);
    });

    it('returns the call again when it was already missed', function (string $reason) {
        $call = makeCall($this->caller, $this->callee, ['status' => 'missed', 'end_reason' => $reason, 'ended_at' => now()]);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk()->assertJsonPath('data.end_reason', $reason);
        Event::assertNotDispatched(CallMissed::class);
    })->with(['cancelled', 'no_answer']);

    it('refuses with call_not_ringing once it was answered or declined', function (string $status) {
        $call = makeCall($this->caller, $this->callee, ['status' => $status, 'answered_at' => $status === 'ongoing' ? now() : null]);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertConflict()->assertJsonPath('code', 'call_not_ringing')->assertJsonPath('call.status', $status);
    })->with(['ongoing', 'declined']);

    it('refuses the callee (who declines instead)', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertForbidden()->assertJsonPath('message', 'Only the person calling can cancel. To say no, decline.');
    });

    it('is a 404 for anyone else, and needs a signed-in user', function () {
        $call = makeCall($this->caller, $this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertUnauthorized();
        signIn($this->stranger);
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertNotFound();
    });
});

describe('POST /calls/{call}/end', function () {
    it('lets either person hang up: ended, hung_up, with the duration', function (string $who) {
        $call = ongoingCall($this->caller, $this->callee, ['answered_at' => now()->subSeconds(75)]);
        signIn($this->{$who});

        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk()
            ->assertJsonPath('data.status', 'ended')
            ->assertJsonPath('data.end_reason', 'hung_up')
            ->assertJsonPath('data.duration_seconds', 75);

        expect($call->room->fresh()->status)->toBe(RoomStatus::Ended)
            ->and($this->livekit->deleted)->toBe([$call->room->livekit_room_name]);
        Event::assertDispatched(CallEnded::class, fn (CallEnded $event) => $event->broadcastAs() === 'call.ended' && count(channelNames($event)) === 2);
    })->with(['caller', 'callee']);

    it('returns the call again when it has already ended, however it ended', function (string $reason) {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ended', 'end_reason' => $reason, 'answered_at' => now()->subMinute(), 'ended_at' => now()]);
        signIn($this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk()->assertJsonPath('data.end_reason', $reason);
        Event::assertNotDispatched(CallEnded::class);
    })->with(['hung_up', 'connection_lost']);

    it('refuses with call_not_ongoing while it rings, or when it was never answered', function (string $status) {
        $call = makeCall($this->caller, $this->callee, ['status' => $status]);
        signIn($this->caller);

        $this->postJson("/api/v1/calls/{$call->id}/end")->assertConflict()
            ->assertJson(['code' => 'call_not_ongoing', 'message' => 'This call is not in progress.', 'call' => ['id' => $call->id, 'status' => $status]]);
    })->with(['ringing', 'declined', 'missed']);

    it('is a 404 for anyone else, and needs a signed-in user', function () {
        $call = ongoingCall($this->caller, $this->callee);

        $this->postJson("/api/v1/calls/{$call->id}/end")->assertUnauthorized();
        signIn($this->stranger);
        $this->postJson("/api/v1/calls/{$call->id}/end")->assertNotFound();
        expect($call->fresh()->status)->toBe(CallStatus::Ongoing);
    });

    it('ends the call once, even if both hang up', function () {
        $call = ongoingCall($this->caller, $this->callee);

        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk();
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk();

        Event::assertDispatchedTimes(CallEnded::class, 1);
        expect($call->chat->messages()->count())->toBe(1)
            ->and($call->fresh()->end_reason)->toBe(CallEndReason::HungUp);
    });
});
