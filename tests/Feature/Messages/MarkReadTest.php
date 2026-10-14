<?php

use App\Models\User;

beforeEach(function () {
    $this->me = signIn();
    $this->friend = User::factory()->create();
    $this->chat = makeDirect($this->me, $this->friend);
    $this->chat->chatMembers()->where('user_id', $this->me->id)->update(['last_read_at' => null]);
});

it('moves the read position and returns the new unread count', function () {
    $first = addMessage($this->chat, $this->friend, ['created_at' => now()->subMinutes(3)]);
    addMessage($this->chat, $this->friend, ['created_at' => now()->subMinutes(2)]);
    addMessage($this->chat, $this->friend, ['created_at' => now()->subMinute()]);

    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $first->id])
        ->assertOk()
        ->assertJsonPath('data.last_read_message_id', $first->id)
        ->assertJsonPath('data.unread_count', 2);

    $membership = $this->chat->membershipOf($this->me)->fresh();
    expect($membership->last_read_message_id)->toBe($first->id)
        ->and($membership->last_read_at->eq($first->fresh()->created_at))->toBeTrue();
});

it('reads everything when given the newest message', function () {
    addMessage($this->chat, $this->friend, ['created_at' => now()->subMinutes(2)]);
    $last = addMessage($this->chat, $this->friend, ['created_at' => now()->subMinute()]);

    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $last->id])->assertJsonPath('data.unread_count', 0);
    $this->getJson('/api/v1/chats')->assertJsonPath('data.0.unread_count', 0);
});

it('never moves the read position backwards', function () {
    $old = addMessage($this->chat, $this->friend, ['created_at' => now()->subMinutes(2)]);
    $new = addMessage($this->chat, $this->friend, ['created_at' => now()->subMinute()]);

    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $new->id])->assertOk();
    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $old->id])
        ->assertOk()
        ->assertJsonPath('data.last_read_message_id', $new->id)
        ->assertJsonPath('data.unread_count', 0);
});

it('is idempotent', function () {
    $message = addMessage($this->chat, $this->friend);

    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertOk();
    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertOk()->assertJsonPath('data.unread_count', 0);
});

it('accepts a message that has since been deleted', function () {
    $message = addMessage($this->chat, $this->friend);
    $message->delete();

    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertOk();
});

it('only affects the caller\'s own read state', function () {
    $message = addMessage($this->chat, $this->me);
    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertOk();

    expect($this->chat->membershipOf($this->friend)->fresh()->last_read_message_id)->toBeNull();
});

it('rejects a message from another chat, a bad id, or none', function (Closure $id) {
    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $id()])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message_id');
})->with([
    'other chat' => fn () => addMessage(makeDirect(User::factory()->create(), User::factory()->create()), null)->id,
    'bad id' => fn () => 'nope',
    'missing' => fn () => null,
]);

it('requires membership', function () {
    $message = addMessage($this->chat, $this->friend);
    signIn(User::factory()->create());

    $this->postJson("/api/v1/chats/{$this->chat->id}/read", ['message_id' => $message->id])->assertForbidden();
});
