<?php

use App\Models\Chat;
use App\Models\User;

beforeEach(function () {
    $this->me = signIn();
    $this->friend = User::factory()->create();
});

it('creates an encrypted direct chat', function () {
    $response = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id, 'is_encrypted' => true])
        ->assertCreated()
        ->assertJsonPath('data.is_encrypted', true)
        ->assertJsonPath('data.type', 'direct');

    $chat = Chat::findOrFail($response->json('data.id'));
    expect($chat->is_encrypted)->toBeTrue()
        ->and($chat->direct_key)->toBe(Chat::directKeyFor($this->me->id, $this->friend->id, true))
        ->and($chat->direct_key)->toEndWith(':e');
});

it('defaults to a plaintext chat', function () {
    $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id])->assertCreated()->assertJsonPath('data.is_encrypted', false);
    $this->postJson('/api/v1/chats/group', ['name' => 'G', 'member_ids' => [$this->friend->id]])->assertCreated()->assertJsonPath('data.is_encrypted', false);
});

it('lets two people have a plaintext and an encrypted direct chat side by side', function () {
    $plain = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id])->assertCreated()->json('data.id');
    $encrypted = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id, 'is_encrypted' => true])->assertCreated()->json('data.id');

    expect($encrypted)->not->toBe($plain)->and(Chat::count())->toBe(2);
});

it('returns the same encrypted chat when asked again, from either side', function () {
    $first = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id, 'is_encrypted' => true])->assertCreated()->json('data.id');
    $again = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id, 'is_encrypted' => true])->assertOk()->json('data.id');

    signIn($this->friend);
    $reverse = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->me->id, 'is_encrypted' => true])->assertOk()->json('data.id');

    expect($again)->toBe($first)->and($reverse)->toBe($first)->and(Chat::count())->toBe(1);
});

it('does not hand back the plaintext chat when an encrypted one is asked for', function () {
    $plain = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id])->json('data.id');

    $encrypted = $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id, 'is_encrypted' => true])
        ->assertCreated()
        ->assertJsonPath('data.is_encrypted', true)
        ->json('data.id');

    expect($encrypted)->not->toBe($plain);
});

it('creates an encrypted group', function () {
    $response = $this->postJson('/api/v1/chats/group', ['name' => 'Secret', 'member_ids' => [$this->friend->id], 'is_encrypted' => true])
        ->assertCreated()
        ->assertJsonPath('data.is_encrypted', true);

    expect(Chat::find($response->json('data.id'))->is_encrypted)->toBeTrue();
});

it('rejects a non-boolean is_encrypted', function () {
    $this->postJson('/api/v1/chats/direct', ['user_id' => $this->friend->id, 'is_encrypted' => 'maybe'])
        ->assertUnprocessable()->assertJsonValidationErrors('is_encrypted');
});

it('cannot turn an existing chat into an encrypted one', function () {
    $chat = makeGroup($this->me, [$this->friend]);

    $this->patchJson("/api/v1/chats/{$chat->id}", ['name' => 'Renamed', 'is_encrypted' => true])->assertOk();

    expect($chat->fresh()->is_encrypted)->toBeFalse();
});

it('cannot turn an encrypted chat back into plaintext', function () {
    $chat = makeEncryptedGroup($this->me, [$this->friend]);

    $this->patchJson("/api/v1/chats/{$chat->id}", ['is_encrypted' => false])->assertOk();

    expect($chat->fresh()->is_encrypted)->toBeTrue();
});

it('shows whether a chat is encrypted in the chat list', function () {
    makeEncryptedGroup($this->me, [$this->friend]);

    $this->getJson('/api/v1/chats')->assertJsonPath('data.0.is_encrypted', true);
});
