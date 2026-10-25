<?php

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Enums\MessageType;
use App\Enums\RoomStatus;
use App\Events\CallMissed;
use App\Events\MessageSent;
use App\Jobs\ExpireRingingCall;
use App\Models\Call;
use App\Models\Message;
use App\Models\RoomParticipant;
use App\Models\User;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    fakeBroadcasts();
    fakeWebPush();
    $this->caller = User::factory()->create();
    $this->callee = User::factory()->create();
});

/** The summary message a call left in its chat. */
function summaryOf(Call $call): Message
{
    return Message::where('chat_id', $call->chat_id)->where('metadata->call_id', $call->id)->sole();
}

describe('the ringing timeout', function () {
    it('is scheduled for the moment the ringing runs out', function () {
        Queue::fake([ExpireRingingCall::class]);
        signIn($this->caller);

        $this->postJson('/api/v1/chats/'.makeDirect($this->caller, $this->callee)->id.'/calls', ['kind' => 'video'])->assertCreated();

        $call = Call::sole();
        Queue::assertPushed(ExpireRingingCall::class, fn (ExpireRingingCall $job) => $job->callId === $call->id && $job->delay->equalTo($call->ring_expires_at));
    });

    it('marks a call nobody answered as missed (no_answer) and closes its room', function () {
        $call = makeCall($this->caller, $this->callee);

        $this->travelTo($call->ring_expires_at->addSecond());
        ExpireRingingCall::dispatchSync($call->id);

        expect($call->fresh()->status)->toBe(CallStatus::Missed)
            ->and($call->fresh()->end_reason)->toBe(CallEndReason::NoAnswer)
            ->and($call->room->fresh()->status)->toBe(RoomStatus::Ended)
            ->and($this->livekit->deleted)->toBe([$call->room->livekit_room_name]);
        Event::assertDispatched(CallMissed::class, fn (CallMissed $event) => channelNames($event) === ["private-user.{$this->caller->id}", "private-user.{$this->callee->id}"]
            && payloadOf($event)['call']['end_reason'] === 'no_answer');
    });

    it('does nothing if it runs before the ringing is over', function () {
        $call = makeCall($this->caller, $this->callee);

        ExpireRingingCall::dispatchSync($call->id);

        expect($call->fresh()->status)->toBe(CallStatus::Ringing);
    });

    it('does nothing to a call that was answered, declined or cancelled meanwhile', function (string $status) {
        $call = makeCall($this->caller, $this->callee, ['status' => $status, 'answered_at' => $status === 'ongoing' ? now() : null]);

        $this->travelTo($call->ring_expires_at->addSecond());
        ExpireRingingCall::dispatchSync($call->id);

        expect($call->fresh()->status->value)->toBe($status);
        Event::assertNotDispatched(CallMissed::class);
    })->with(['ongoing', 'declined']);

    it('does nothing for a call that is gone', function () {
        ExpireRingingCall::dispatchSync('9b2f3c4d-0000-4000-8000-000000000000');

        expect(Call::count())->toBe(0);
    });
});

describe('the summary message in the chat', function () {
    it('says "Missed video call" for a call nobody answered', function () {
        $call = makeCall($this->caller, $this->callee);
        $this->travelTo($call->ring_expires_at->addSecond());
        ExpireRingingCall::dispatchSync($call->id);

        $message = summaryOf($call);
        expect($message->type)->toBe(MessageType::System)
            ->and($message->sender_id)->toBeNull()
            ->and($message->content)->toBe('Missed video call')
            ->and($message->metadata)->toEqual([
                'event' => 'call',
                'kind' => 'video',
                'status' => 'missed',
                'call_id' => $call->id,
                'caller_id' => $this->caller->id,
                'end_reason' => 'no_answer',
                'duration_seconds' => null,
            ]);
    });

    it('says "Missed voice call" when the caller cancels', function () {
        $call = makeCall($this->caller, $this->callee, ['kind' => 'voice']);
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        expect(summaryOf($call)->content)->toBe('Missed voice call')
            ->and(summaryOf($call)->metadata['end_reason'])->toBe('cancelled');
    });

    it('says "Voice call declined" when the callee says no', function () {
        $call = makeCall($this->caller, $this->callee, ['kind' => 'voice']);
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        expect(summaryOf($call)->content)->toBe('Voice call declined')
            ->and(summaryOf($call)->metadata)->toMatchArray(['status' => 'declined', 'end_reason' => null, 'duration_seconds' => null]);
    });

    it('gives the length of an answered call: "Video call · 3:12"', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subSeconds(192)]);
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk();

        expect(summaryOf($call)->content)->toBe('Video call · 3:12')
            ->and(summaryOf($call)->metadata)->toMatchArray(['status' => 'ended', 'end_reason' => 'hung_up', 'duration_seconds' => 192]);
    });

    it('counts hours past an hour: "Video call · 1:02:03"', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subSeconds(3723)]);
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk();

        expect(summaryOf($call)->content)->toBe('Video call · 1:02:03');
    });

    it('is broadcast as message.sent to both people, like any message', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        Event::assertDispatched(MessageSent::class, fn (MessageSent $event) => payloadOf($event)['message']['metadata']['event'] === 'call'
            && in_array("private-user.{$this->caller->id}", channelNames($event), true)
            && in_array("private-user.{$this->callee->id}", channelNames($event), true));
    });

    it('reaches the device whose request ended the call too (it has no copy of the summary)', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);
        $this->withHeader('X-Socket-ID', '1234.5678')->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        Event::assertDispatched(MessageSent::class, fn (MessageSent $event) => payloadOf($event)['message']['type'] === 'system' && $event->socket === null);
    });

    it('a person\'s own message still skips the device that sent it', function () {
        $chat = makeDirect($this->caller, $this->callee);
        signIn($this->caller);
        $this->withHeader('X-Socket-ID', '1234.5678')->postJson("/api/v1/chats/{$chat->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'content' => 'Hi'])->assertCreated();

        Event::assertDispatched(MessageSent::class, fn (MessageSent $event) => $event->socket === '1234.5678');
    });

    it('moves the chat to the top of the list', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$call->id}/decline")->assertOk();

        expect($call->chat->fresh()->last_message_at->equalTo(summaryOf($call)->created_at))->toBeTrue();
    });

    it('is posted only once, however many ways the call is ended at once', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);

        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/end")->assertOk();
        sendLiveKitWebhook($this, livekitEvent($call->room, 'room_finished'))->assertOk();
        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect(Message::where('chat_id', $call->chat_id)->count())->toBe(1);
    });
});

describe('unread counts', function () {
    function unreadIn($test, User $as, Call $call): int
    {
        signIn($as);

        return collect($test->getJson('/api/v1/chats')->assertOk()->json('data'))->firstWhere('id', $call->chat_id)['unread_count'];
    }

    it('counts a missed call for the person who missed it', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        expect(unreadIn($this, $this->callee, $call))->toBe(1)
            ->and($call->chat->unreadCountFor($this->callee))->toBe(1);
    });

    it('does not count it for the caller', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        expect(unreadIn($this, $this->caller, $call))->toBe(0)
            ->and($call->chat->unreadCountFor($this->caller))->toBe(0);
    });

    it('does not count declined or answered calls, or other system messages', function () {
        $declined = makeCall($this->caller, $this->callee);
        signIn($this->callee);
        $this->postJson("/api/v1/calls/{$declined->id}/decline")->assertOk();
        $answered = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        $this->postJson("/api/v1/calls/{$answered->id}/end")->assertOk();
        addMessage($declined->chat, null, ['type' => 'system', 'content' => 'Room started', 'metadata' => ['event' => 'room_created']]);

        expect(unreadIn($this, $this->callee, $declined))->toBe(0)
            ->and(unreadIn($this, $this->caller, $declined))->toBe(0);
    });

    it('stops counting once the chat is read', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();

        signIn($this->callee);
        $this->postJson("/api/v1/chats/{$call->chat_id}/read", ['message_id' => summaryOf($call)->id])->assertOk()->assertJsonPath('data.unread_count', 0);
    });

    it('still counts ordinary messages from the other person', function () {
        $call = makeCall($this->caller, $this->callee);
        signIn($this->caller);
        $this->postJson("/api/v1/calls/{$call->id}/cancel")->assertOk();
        $this->travel(1)->seconds();
        addMessage($call->chat, $this->caller, ['content' => 'Call me back']);

        expect(unreadIn($this, $this->callee, $call))->toBe(2);
    });
});

describe('the stale cleanup (rooms:end-stale)', function () {
    it('marks calls that rang out as missed when the timeout job did not', function () {
        $stale = makeCall($this->caller, $this->callee, ['ring_expires_at' => now()->subMinute()]);
        $fresh = makeCall(User::factory()->create(), User::factory()->create());

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 1 call(s) that rang out unanswered and 0 whose connection was lost.')->assertSuccessful();

        expect($stale->fresh()->end_reason)->toBe(CallEndReason::NoAnswer)
            ->and($fresh->fresh()->status)->toBe(CallStatus::Ringing);
    });

    it('ends an answered call when someone has been gone longer than the grace', function () {
        config(['calls.reconnect_grace_seconds' => 30]);
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinutes(5)]);
        RoomParticipant::where('room_id', $call->room_id)->update(['joined_at' => ts(now()->subMinutes(5))]);
        RoomParticipant::where('room_id', $call->room_id)->where('user_id', $this->callee->id)->update(['left_at' => ts(now()->subMinute())]);

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 0 call(s) that rang out unanswered and 1 whose connection was lost.')->assertSuccessful();

        expect($call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost)
            ->and($call->room->fresh()->status)->toBe(RoomStatus::Ended);
    });

    it('ends an answered call that one of them never connected to', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinutes(10)]);
        RoomParticipant::where('room_id', $call->room_id)->where('user_id', $this->caller->id)->update(['joined_at' => ts(now()->subMinutes(10))]);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect($call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost);
    });

    it('ends an answered call whose room has ended', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        RoomParticipant::where('room_id', $call->room_id)->update(['joined_at' => ts(now()->subMinute())]);
        $call->room->update(['status' => RoomStatus::Ended, 'ended_at' => now()]);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect($call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost);
    });

    it('ends an answered call that has gone on longer than any room may', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subHours(25)]);
        RoomParticipant::where('room_id', $call->room_id)->update(['joined_at' => ts(now()->subHours(25))]);

        $this->artisan('rooms:end-stale')->assertSuccessful();

        expect($call->fresh()->end_reason)->toBe(CallEndReason::ConnectionLost);
    });

    it('leaves a healthy call alone', function () {
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subMinutes(20)]);
        RoomParticipant::where('room_id', $call->room_id)->update(['joined_at' => ts(now()->subMinutes(20))]);
        $justAnswered = makeCall(User::factory()->create(), User::factory()->create(), ['status' => 'ongoing', 'answered_at' => now()->subSeconds(10)]);
        // Dropped out 10 s ago: still within the grace.
        $blip = makeCall(User::factory()->create(), User::factory()->create(), ['status' => 'ongoing', 'answered_at' => now()->subMinutes(3)]);
        RoomParticipant::where('room_id', $blip->room_id)->update(['joined_at' => ts(now()->subMinutes(3))]);
        RoomParticipant::where('room_id', $blip->room_id)->where('user_id', $blip->callee_id)->update(['left_at' => ts(now()->subSeconds(10))]);

        $this->artisan('rooms:end-stale')->expectsOutput('Ended 0 call(s) that rang out unanswered and 0 whose connection was lost.')->assertSuccessful();

        expect([$call->fresh()->status, $justAnswered->fresh()->status, $blip->fresh()->status])->each->toBe(CallStatus::Ongoing);
    });

    it('leaves the room of a call that is going on to the call rules', function () {
        // The caller joined while it rang, so the room started just over 24 hours ago: by the room rules
        // alone it has run too long. The call was answered just under 24 hours ago and both are still
        // connected, so the call is fine, and its room must not be ended from under it.
        $call = makeCall($this->caller, $this->callee, ['status' => 'ongoing', 'answered_at' => now()->subHours(24)->addMinute()]);
        $call->room->update(['status' => RoomStatus::Active, 'started_at' => now()->subHours(24)->subMinute()]);
        RoomParticipant::where('room_id', $call->room_id)->update(['joined_at' => ts(now()->subHours(24)->subMinute())]);

        $this->artisan('rooms:end-stale')
            ->expectsOutput('Ended 0 call(s) that rang out unanswered and 0 whose connection was lost.')
            ->expectsOutput('Ended 0 room(s) nobody joined, 0 empty and 0 running too long.')
            ->assertSuccessful();

        expect($call->fresh()->status)->toBe(CallStatus::Ongoing)
            ->and($call->room->fresh()->status)->toBe(RoomStatus::Active);
    });
});
