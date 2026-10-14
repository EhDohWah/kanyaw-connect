<?php

use App\Models\Chat;
use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Str;

function sendPayload(array $overrides = []): array
{
    return array_merge([
        'client_id' => (string) Str::uuid(),
        'type' => 'text',
        'content' => 'Hello everyone',
    ], $overrides);
}

beforeEach(function () {
    $this->me = signIn();
    $this->friend = User::factory()->create();
    $this->chat = makeDirect($this->me, $this->friend);
});

it('sends a text message', function () {
    $payload = sendPayload();

    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", $payload)
        ->assertCreated()
        ->assertJsonPath('data.content', 'Hello everyone')
        ->assertJsonPath('data.type', 'text')
        ->assertJsonPath('data.sender.id', $this->me->id)
        ->assertJsonPath('data.client_id', $payload['client_id'])
        ->assertJsonPath('data.is_edited', false)
        ->assertJsonPath('data.attachment', null);

    expect(Message::count())->toBe(1)
        ->and(Message::first()->only(['chat_id', 'sender_id', 'client_id']))
        ->toBe(['chat_id' => $this->chat->id, 'sender_id' => $this->me->id, 'client_id' => $payload['client_id']]);
});

it('is idempotent on client_id: a retry returns the original with 200', function () {
    $payload = sendPayload();

    $first = $this->postJson("/api/v1/chats/{$this->chat->id}/messages", $payload)->assertCreated();
    $retry = $this->postJson("/api/v1/chats/{$this->chat->id}/messages", $payload)->assertOk();

    expect($retry->json('data.id'))->toBe($first->json('data.id'))
        ->and(Message::count())->toBe(1);
});

it('ignores changed content on a retry and returns what was stored', function () {
    $payload = sendPayload();
    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", $payload)->assertCreated();

    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", [...$payload, 'content' => 'different'])
        ->assertOk()
        ->assertJsonPath('data.content', 'Hello everyone');
});

it('lets different users use the same client_id', function () {
    $shared = (string) Str::uuid();
    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload(['client_id' => $shared]))->assertCreated();

    signIn($this->friend);
    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload(['client_id' => $shared]))->assertCreated();

    expect(Message::count())->toBe(2);
});

it('answers 409 when a client_id was already used in another chat', function () {
    $shared = (string) Str::uuid();
    $other = makeDirect($this->me, User::factory()->create());
    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload(['client_id' => $shared]))->assertCreated();

    $this->postJson("/api/v1/chats/{$other->id}/messages", sendPayload(['client_id' => $shared]))
        ->assertStatus(409)
        ->assertJsonStructure(['message']);

    expect(Message::count())->toBe(1);
});

it('answers 409 rather than resurrecting a deleted message on retry', function () {
    $payload = sendPayload();
    $id = $this->postJson("/api/v1/chats/{$this->chat->id}/messages", $payload)->json('data.id');
    $this->deleteJson("/api/v1/messages/{$id}")->assertNoContent();

    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", $payload)->assertStatus(409);
});

it('updates the chat activity time and the member count stays correct', function () {
    $this->chat->update(['last_message_at' => now()->subDay()]);

    $id = $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->json('data.id');

    $chat = $this->chat->fresh();
    expect($chat->last_message_at->eq(Message::find($id)->created_at))->toBeTrue()
        ->and($chat->member_count)->toBe(2);
});

it('does not move the chat activity time backwards', function () {
    $future = now()->addHour();
    $this->chat->update(['last_message_at' => $future]);

    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->assertCreated();

    expect($this->chat->fresh()->last_message_at->eq($future))->toBeTrue();
});

it('marks the chat read for the sender up to their new message', function () {
    addMessage($this->chat, $this->friend, ['created_at' => now()->subMinute()]);
    expect($this->chat->unreadCountFor($this->me))->toBe(1);

    $id = $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->json('data.id');

    $membership = $this->chat->membershipOf($this->me)->fresh();
    expect($membership->last_read_message_id)->toBe($id)
        ->and($this->chat->unreadCountFor($this->me))->toBe(0);
});

it('makes the message unread for the other person', function () {
    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->assertCreated();

    signIn($this->friend);
    $this->getJson('/api/v1/chats')->assertJsonPath('data.0.unread_count', 1);
});

it('can reply to a message in the same chat', function () {
    $original = addMessage($this->chat, $this->friend, ['content' => 'What time is the meeting?']);

    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload(['reply_to_id' => $original->id]))
        ->assertCreated()
        ->assertJsonPath('data.reply_to_id', $original->id)
        ->assertJsonPath('data.reply_to.content', 'What time is the meeting?')
        ->assertJsonPath('data.reply_to.is_deleted', false);
});

it('rejects replying to a message from another chat or a deleted message', function () {
    $elsewhere = addMessage(makeDirect($this->friend, User::factory()->create()), $this->friend);
    $deleted = addMessage($this->chat, $this->friend);
    $deleted->delete();

    foreach ([$elsewhere, $deleted] as $target) {
        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload(['reply_to_id' => $target->id]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('reply_to_id');
    }
    expect(Message::where('sender_id', $this->me->id)->count())->toBe(0);
});

it('validates the payload', function (array $payload, string $field) {
    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", $payload)
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'no client_id' => [['type' => 'text', 'content' => 'hi'], 'client_id'],
    'client_id not a uuid' => [['client_id' => 'abc', 'type' => 'text', 'content' => 'hi'], 'client_id'],
    'no type' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'content' => 'hi'], 'type'],
    'unknown type' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'type' => 'video', 'content' => 'hi'], 'type'],
    'system type is server-only' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'type' => 'system', 'content' => 'hi'], 'type'],
    'text without content' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'type' => 'text'], 'content'],
    'empty text' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'type' => 'text', 'content' => ''], 'content'],
    'text too long' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'type' => 'text', 'content' => str_repeat('a', 5001)], 'content'],
    'image without attachment' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'type' => 'image'], 'metadata.attachment_id'],
    'file with bad attachment id' => [['client_id' => '5c7b5b2e-8d0e-4a7b-9d3a-0e1a5b8f3c11', 'type' => 'file', 'metadata' => ['attachment_id' => 'x']], 'metadata.attachment_id'],
]);

it('stores a single message for each unique client_id even when many are sent', function () {
    foreach (range(1, 3) as $_) {
        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->assertCreated();
    }

    expect(Message::count())->toBe(3);
});

it('does not let clients set server-controlled fields', function () {
    $other = User::factory()->create();

    $id = $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload([
        'sender_id' => $other->id,
        'chat_id' => (string) Str::uuid(),
        'is_edited' => true,
        'created_at' => '2001-01-01 00:00:00',
        'metadata' => ['role' => 'admin'],
    ]))->assertCreated()->json('data.id');

    $message = Message::find($id);
    expect($message->sender_id)->toBe($this->me->id)
        ->and($message->chat_id)->toBe($this->chat->id)
        ->and($message->is_edited)->toBeFalse()
        ->and($message->created_at->year)->toBeGreaterThan(2020)
        ->and($message->metadata)->toBe([]);
});

it('rate limits sending to 30 messages a minute per user', function () {
    foreach (range(1, 30) as $_) {
        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->assertCreated();
    }

    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->assertTooManyRequests();

    // Another user has their own allowance.
    signIn($this->friend);
    $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->assertCreated();
});

it('shares the rate limit across all of the user\'s chats', function () {
    $second = makeDirect($this->me, User::factory()->create());

    foreach (range(1, 15) as $_) {
        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", sendPayload())->assertCreated();
        $this->postJson("/api/v1/chats/{$second->id}/messages", sendPayload())->assertCreated();
    }

    $this->postJson("/api/v1/chats/{$second->id}/messages", sendPayload())->assertTooManyRequests();
});

it('works in group chats', function () {
    $group = makeGroup($this->friend, [$this->me]);

    $this->postJson("/api/v1/chats/{$group->id}/messages", sendPayload())->assertCreated();
    expect(Chat::find($group->id)->messages()->count())->toBe(1);
});
