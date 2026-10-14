<?php

use App\Models\Message;
use App\Models\User;
use Illuminate\Support\Str;

describe('non-members get 403 on every chat and message endpoint', function () {
    it('is forbidden', function (string $method, string $uri, array $body) {
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $chat = makeGroup($owner, [$member]);
        $message = addMessage($chat, $member);
        $outsider = signIn();

        $uri = str_replace(['{chat}', '{message}', '{user}'], [$chat->id, $message->id, $member->id], $uri);
        $body = array_map(fn ($v) => $v === '{message}' ? $message->id : $v, $body);

        $this->json($method, $uri, $body)->assertForbidden();
    })->with([
        'show' => ['GET', '/api/v1/chats/{chat}', []],
        'update' => ['PATCH', '/api/v1/chats/{chat}', ['name' => 'Hijacked']],
        'leave' => ['DELETE', '/api/v1/chats/{chat}/leave', []],
        'add members' => ['POST', '/api/v1/chats/{chat}/members', ['user_ids' => []]],
        'remove member' => ['DELETE', '/api/v1/chats/{chat}/members/{user}', []],
        'change role' => ['PATCH', '/api/v1/chats/{chat}/members/{user}', ['role' => 'admin']],
        'list messages' => ['GET', '/api/v1/chats/{chat}/messages', []],
        'send message' => ['POST', '/api/v1/chats/{chat}/messages', ['client_id' => 'x', 'type' => 'text', 'content' => 'hi']],
        'mark read' => ['POST', '/api/v1/chats/{chat}/read', ['message_id' => '{message}']],
        'upload attachment' => ['POST', '/api/v1/chats/{chat}/attachments', []],
        'edit message' => ['PATCH', '/api/v1/messages/{message}', ['content' => 'edited']],
        'delete message' => ['DELETE', '/api/v1/messages/{message}', []],
    ]);
});

it('requires authentication on every chat and message endpoint', function (string $method, string $uri) {
    $id = (string) Str::uuid();
    $uri = str_replace(['{chat}', '{message}', '{user}'], $id, $uri);

    $this->json($method, $uri)->assertUnauthorized();
})->with([
    ['GET', '/api/v1/chats'],
    ['GET', '/api/v1/chats/{chat}'],
    ['PATCH', '/api/v1/chats/{chat}'],
    ['DELETE', '/api/v1/chats/{chat}/leave'],
    ['POST', '/api/v1/chats/{chat}/members'],
    ['PATCH', '/api/v1/chats/{chat}/members/{user}'],
    ['DELETE', '/api/v1/chats/{chat}/members/{user}'],
    ['GET', '/api/v1/chats/{chat}/messages'],
    ['POST', '/api/v1/chats/{chat}/messages'],
    ['POST', '/api/v1/chats/{chat}/read'],
    ['POST', '/api/v1/chats/{chat}/attachments'],
    ['PATCH', '/api/v1/messages/{message}'],
    ['DELETE', '/api/v1/messages/{message}'],
]);

it('is forbidden before validation runs, so it reveals nothing about the chat', function () {
    $chat = makeGroup(User::factory()->create());
    signIn();

    // Invalid body, but the 403 must win over the 422.
    $this->postJson("/api/v1/chats/{$chat->id}/messages", [])->assertForbidden();
    $this->postJson("/api/v1/chats/{$chat->id}/read", ['message_id' => 'nope'])->assertForbidden();
});

it('returns 404 for chats and messages that do not exist', function () {
    signIn();
    $id = (string) Str::uuid();

    $this->getJson("/api/v1/chats/{$id}")->assertNotFound();
    $this->getJson("/api/v1/chats/{$id}/messages")->assertNotFound();
    $this->patchJson("/api/v1/messages/{$id}", ['content' => 'x'])->assertNotFound();
});

it('returns 404 for ids that are not UUIDs rather than a server error', function () {
    signIn();

    $this->getJson('/api/v1/chats/not-a-uuid')->assertNotFound();
    $this->getJson('/api/v1/chats/not-a-uuid/messages')->assertNotFound();
});

it('shows a chat with its members to a member', function () {
    $owner = User::factory()->create();
    $me = signIn();
    $chat = makeGroup($owner, [$me]);
    addMessage($chat, $owner, ['content' => 'hello']);

    $this->getJson("/api/v1/chats/{$chat->id}")
        ->assertOk()
        ->assertJsonPath('data.id', $chat->id)
        ->assertJsonPath('data.unread_count', 1)
        ->assertJsonPath('data.latest_message.content', 'hello')
        ->assertJsonCount(2, 'data.members')
        ->assertJsonPath('data.my_membership.role', 'member');
});

it('stops a user who left from reading the chat or editing their old messages', function () {
    $owner = User::factory()->create();
    $leaver = User::factory()->create();
    $chat = makeGroup($owner, [$leaver]);
    $old = addMessage($chat, $leaver);

    signIn($leaver);
    $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();

    $this->getJson("/api/v1/chats/{$chat->id}/messages")->assertForbidden();
    $this->patchJson("/api/v1/messages/{$old->id}", ['content' => 'x'])->assertForbidden();
    $this->deleteJson("/api/v1/messages/{$old->id}")->assertForbidden();
    expect(Message::find($old->id))->not->toBeNull();
});
