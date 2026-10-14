<?php

use App\Events\ChatMemberAdded;
use App\Events\ChatMemberRemoved;
use App\Events\ChatUpdated;
use App\Events\MessageDeleted;
use App\Events\MessageRead;
use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Models\User;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;

function sendText($test, $chat, string $content = 'Hello', ?string $clientId = null)
{
    return $test->postJson("/api/v1/chats/{$chat->id}/messages", [
        'client_id' => $clientId ?? (string) Str::uuid(),
        'type' => 'text',
        'content' => $content,
    ]);
}

beforeEach(function () {
    fakeBroadcasts();
    $this->me = signIn(User::factory()->create(['phone' => '+66811111111']));
    $this->friend = User::factory()->create(['phone' => '+66822222222']);
    $this->third = User::factory()->create();
    $this->chat = makeGroup($this->me, [$this->friend, $this->third]);
});

describe('message.sent', function () {
    it('goes to the chat channel and to every member\'s user channel', function () {
        sendText($this, $this->chat, 'Hello everyone')->assertCreated();

        Event::assertDispatchedTimes(MessageSent::class, 1);
        Event::assertDispatched(MessageSent::class, function (MessageSent $event) {
            expect($event->broadcastAs())->toBe('message.sent')
                ->and(channelNames($event))->toEqualCanonicalizing([
                    "private-chat.{$this->chat->id}",
                    "private-user.{$this->me->id}",
                    "private-user.{$this->friend->id}",
                    "private-user.{$this->third->id}",
                ]);

            return true;
        });
    });

    it('carries the message as the API shows it', function () {
        $id = sendText($this, $this->chat, 'Hello everyone')->json('data.id');

        Event::assertDispatched(MessageSent::class, function (MessageSent $event) use ($id) {
            $message = payloadOf($event)['message'];
            expect($message['id'])->toBe($id)
                ->and($message['chat_id'])->toBe($this->chat->id)
                ->and($message['content'])->toBe('Hello everyone')
                ->and($message['type'])->toBe('text')
                ->and($message['sender'])->toBe([
                    'id' => $this->me->id,
                    'name' => $this->me->name,
                    'avatar_url' => null,
                    'avatar_thumb_url' => null,
                ])
                ->and($message['metadata'])->toBe([]);

            return true;
        });
    });

    it('never contains email, phone numbers or the sender\'s client_id', function () {
        $clientId = (string) Str::uuid();
        sendText($this, $this->chat, 'Hi', $clientId)->assertCreated();

        Event::assertDispatched(MessageSent::class, function (MessageSent $event) use ($clientId) {
            $json = json_encode($event->broadcastWith());
            expect($json)
                ->not->toContain($this->me->email)->not->toContain($this->friend->email)
                ->not->toContain('+66811111111')->not->toContain('+66822222222')
                ->not->toContain($clientId);

            return true;
        });
    });

    it('is not sent again for a retry with the same client_id', function () {
        $clientId = (string) Str::uuid();
        sendText($this, $this->chat, 'Hi', $clientId)->assertCreated();
        sendText($this, $this->chat, 'Hi', $clientId)->assertOk();

        Event::assertDispatchedTimes(MessageSent::class, 1);
    });

    it('is not sent when the request is rejected', function () {
        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", [])->assertUnprocessable();

        signIn(User::factory()->create());
        sendText($this, $this->chat)->assertForbidden();

        Event::assertNotDispatched(MessageSent::class);
    });

    it('is split over several events when there are more than 100 channels', function () {
        $big = makeGroup($this->me, User::factory()->count(149)->create()->all());

        sendText($this, $big)->assertCreated();

        $events = Event::dispatched(MessageSent::class)->map(fn ($args) => $args[0]);
        $channels = $events->flatMap(fn ($event) => channelNames($event));

        expect($events)->toHaveCount(2)
            ->and($events->every(fn ($event) => count($event->broadcastOn()) <= 100))->toBeTrue()
            ->and($channels)->toHaveCount(151) // chat + 150 members
            ->and($channels->unique())->toHaveCount(151)
            ->and($channels->filter(fn ($c) => $c === "private-chat.{$big->id}"))->toHaveCount(1);
    });

    it('is queued for a worker rather than published during the request', function () {
        $event = new MessageSent($this->chat->id, [], []);

        expect($event)->toBeInstanceOf(ShouldBroadcast::class)->not->toBeInstanceOf(ShouldBroadcastNow::class);
    });

    it('skips the socket that sent it, so the sending device does not get its own message back', function () {
        $this->withHeader('X-Socket-ID', '4242.9999');
        sendText($this, $this->chat)->assertCreated();

        Event::assertDispatched(MessageSent::class, fn (MessageSent $event) => $event->socket === '4242.9999');
    });
});

describe('message.updated and message.deleted', function () {
    it('announces an edit on the chat channel', function () {
        $message = addMessage($this->chat, $this->me, ['content' => 'old']);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'new'])->assertOk();

        Event::assertDispatched(MessageUpdated::class, function (MessageUpdated $event) use ($message) {
            expect($event->broadcastAs())->toBe('message.updated')
                ->and(channelNames($event))->toBe(["private-chat.{$this->chat->id}"])
                ->and(payloadOf($event)['message']['id'])->toBe($message->id)
                ->and(payloadOf($event)['message']['content'])->toBe('new')
                ->and(payloadOf($event)['message']['is_edited'])->toBeTrue();

            return true;
        });
    });

    it('announces a deletion with just the ids', function () {
        $message = addMessage($this->chat, $this->me, ['content' => 'secret']);

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();

        Event::assertDispatched(MessageDeleted::class, function (MessageDeleted $event) use ($message) {
            expect($event->broadcastAs())->toBe('message.deleted')
                ->and(channelNames($event))->toBe(["private-chat.{$this->chat->id}"])
                ->and(payloadOf($event))->toBe(['chat_id' => $this->chat->id, 'message_id' => $message->id]);

            return true;
        });
    });

    it('sends nothing when the edit or delete is forbidden', function () {
        $message = addMessage($this->chat, $this->friend);
        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'x'])->assertForbidden();
        signIn($this->third);
        $this->deleteJson("/api/v1/messages/{$message->id}")->assertForbidden();

        Event::assertNotDispatched(MessageUpdated::class);
        Event::assertNotDispatched(MessageDeleted::class);
    });
});

describe('message.read', function () {
    it('goes to the chat and to the reader\'s own devices', function () {
        $message = addMessage($this->chat, $this->friend, ['created_at' => now()->subMinute()]);

        $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertOk();

        Event::assertDispatched(MessageRead::class, function (MessageRead $event) use ($message) {
            expect($event->broadcastAs())->toBe('message.read')
                ->and(channelNames($event))->toEqualCanonicalizing(["private-chat.{$this->chat->id}", "private-user.{$this->me->id}"])
                ->and(payloadOf($event))->toMatchArray([
                    'chat_id' => $this->chat->id,
                    'user_id' => $this->me->id,
                    'last_read_message_id' => $message->id,
                ])
                ->and(payloadOf($event)['last_read_at'])->not->toBeNull();

            return true;
        });
    });

    it('is not sent when the read position did not move', function () {
        $message = addMessage($this->chat, $this->friend, ['created_at' => now()->subMinute()]);

        $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertOk();
        $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertOk();

        Event::assertDispatchedTimes(MessageRead::class, 1);
    });
});

describe('chat.updated', function () {
    it('goes to the chat and to every member', function () {
        $this->patchJson("/api/v1/chats/{$this->chat->id}", ['name' => 'Renamed'])->assertOk();

        Event::assertDispatched(ChatUpdated::class, function (ChatUpdated $event) {
            expect($event->broadcastAs())->toBe('chat.updated')
                ->and(channelNames($event))->toContain("private-chat.{$this->chat->id}", "private-user.{$this->friend->id}")
                ->and(payloadOf($event)['chat'])->toMatchArray(['id' => $this->chat->id, 'name' => 'Renamed', 'type' => 'group']);

            return true;
        });
    });

    it('is not sent when nothing changed', function () {
        $this->patchJson("/api/v1/chats/{$this->chat->id}", ['name' => $this->chat->name])->assertOk();

        Event::assertNotDispatched(ChatUpdated::class);
    });

    it('is not sent when a plain member tries to rename', function () {
        signIn($this->friend);
        $this->patchJson("/api/v1/chats/{$this->chat->id}", ['name' => 'Hijack'])->assertForbidden();

        Event::assertNotDispatched(ChatUpdated::class);
    });
});

describe('chat.member_added', function () {
    it('tells the chat and the new member', function () {
        $newcomer = User::factory()->create(['phone' => '+66833333333']);

        $this->postJson("/api/v1/chats/{$this->chat->id}/members", ['user_ids' => [$newcomer->id]])->assertOk();

        Event::assertDispatchedTimes(ChatMemberAdded::class, 1);
        Event::assertDispatched(ChatMemberAdded::class, function (ChatMemberAdded $event) use ($newcomer) {
            expect($event->broadcastAs())->toBe('chat.member_added')
                ->and(channelNames($event))->toEqualCanonicalizing(["private-chat.{$this->chat->id}", "private-user.{$newcomer->id}"])
                ->and(payloadOf($event)['chat'])->toMatchArray(['id' => $this->chat->id, 'member_count' => 4])
                ->and(payloadOf($event)['user'])->toBe(['id' => $newcomer->id, 'name' => $newcomer->name, 'avatar_url' => null, 'avatar_thumb_url' => null]);
            expect(json_encode($event->broadcastWith()))->not->toContain($newcomer->email)->not->toContain('+66833333333');

            return true;
        });
    });

    it('is only sent for people who were really added', function () {
        $newcomer = User::factory()->create();

        $this->postJson("/api/v1/chats/{$this->chat->id}/members", ['user_ids' => [$this->friend->id, $newcomer->id]])->assertOk();

        Event::assertDispatchedTimes(ChatMemberAdded::class, 1);
        Event::assertDispatched(ChatMemberAdded::class, fn ($e) => payloadOf($e)['user']['id'] === $newcomer->id);
    });

    it('tells a user about a brand-new direct chat on their user channel only', function () {
        $stranger = User::factory()->create();

        $chatId = $this->postJson('/api/v1/chats/direct', ['user_id' => $stranger->id])->assertCreated()->json('data.id');

        Event::assertDispatchedTimes(ChatMemberAdded::class, 1);
        Event::assertDispatched(ChatMemberAdded::class, function (ChatMemberAdded $event) use ($stranger, $chatId) {
            expect(channelNames($event))->toBe(["private-user.{$stranger->id}"])
                ->and(payloadOf($event)['chat']['id'])->toBe($chatId)
                ->and(payloadOf($event)['chat']['type'])->toBe('direct')
                ->and(payloadOf($event)['user']['id'])->toBe($stranger->id);

            return true;
        });
    });

    it('does not announce an existing direct chat again', function () {
        makeDirect($this->me, $this->friend);

        $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id])->assertOk();

        Event::assertNotDispatched(ChatMemberAdded::class);
    });

    it('tells every invited member of a new group, but not its creator', function () {
        [$a, $b] = User::factory()->count(2)->create();

        $this->postJson('/api/v1/chats/group', ['name' => 'New group', 'member_ids' => [$a->id, $b->id]])->assertCreated();

        $channels = Event::dispatched(ChatMemberAdded::class)->map(fn ($args) => channelNames($args[0]))->flatten();
        expect($channels)->toHaveCount(2)
            ->and($channels->all())->toEqualCanonicalizing(["private-user.{$a->id}", "private-user.{$b->id}"]);
    });
});

describe('chat.member_removed', function () {
    it('tells the chat and the removed member', function () {
        $this->deleteJson("/api/v1/chats/{$this->chat->id}/members/{$this->friend->id}")->assertNoContent();

        Event::assertDispatched(ChatMemberRemoved::class, function (ChatMemberRemoved $event) {
            expect($event->broadcastAs())->toBe('chat.member_removed')
                ->and(channelNames($event))->toEqualCanonicalizing(["private-chat.{$this->chat->id}", "private-user.{$this->friend->id}"])
                ->and(payloadOf($event))->toBe(['chat_id' => $this->chat->id, 'user_id' => $this->friend->id]);

            return true;
        });
    });

    it('is also sent when someone leaves', function () {
        signIn($this->friend);

        $this->deleteJson("/api/v1/chats/{$this->chat->id}/leave")->assertNoContent();

        Event::assertDispatched(ChatMemberRemoved::class, fn ($e) => payloadOf($e)['user_id'] === $this->friend->id);
    });

    it('is not sent when the removal is forbidden', function () {
        signIn($this->friend);

        $this->deleteJson("/api/v1/chats/{$this->chat->id}/members/{$this->third->id}")->assertForbidden();

        Event::assertNotDispatched(ChatMemberRemoved::class);
    });
});
