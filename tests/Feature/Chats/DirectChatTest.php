<?php

use App\Enums\ChatRole;
use App\Models\Chat;
use App\Models\User;
use Illuminate\Support\Str;

it('creates a direct chat between two users', function () {
    $me = signIn();
    $other = User::factory()->create();

    $response = $this->postJson('/api/v1/chats/direct', ['user_id' => $other->id]);

    $response->assertCreated()
        ->assertJsonPath('data.type', 'direct')
        ->assertJsonPath('data.member_count', 2)
        ->assertJsonPath('data.other_user.id', $other->id)
        ->assertJsonPath('data.unread_count', 0)
        ->assertJsonPath('data.my_membership.role', 'member')
        ->assertJsonPath('data.is_encrypted', false);

    $chat = Chat::findOrFail($response->json('data.id'));
    expect($chat->direct_key)->toBe(Chat::directKeyFor($me->id, $other->id))
        ->and($chat->chatMembers()->pluck('user_id')->all())->toContain($me->id, $other->id)
        ->and($chat->chatMembers()->where('role', ChatRole::Member)->count())->toBe(2);
});

it('returns the same chat when created twice, in either direction', function () {
    $me = signIn();
    $other = User::factory()->create();

    $first = $this->postJson('/api/v1/chats/direct', ['user_id' => $other->id])->assertCreated();
    $second = $this->postJson('/api/v1/chats/direct', ['user_id' => $other->id])->assertOk();

    signIn($other);
    $third = $this->postJson('/api/v1/chats/direct', ['user_id' => $me->id])->assertOk();

    expect($second->json('data.id'))->toBe($first->json('data.id'))
        ->and($third->json('data.id'))->toBe($first->json('data.id'))
        ->and(Chat::count())->toBe(1);
});

it('shows each side the other person, not themselves', function () {
    $me = signIn();
    $other = User::factory()->create();
    $chatId = $this->postJson('/api/v1/chats/direct', ['user_id' => $other->id])->json('data.id');

    signIn($other);
    $this->getJson("/api/v1/chats/{$chatId}")->assertOk()->assertJsonPath('data.other_user.id', $me->id);
});

it('does not expose the other user\'s email or phone', function () {
    signIn();
    $other = User::factory()->create(['phone' => '+66812345678']);

    $response = $this->postJson('/api/v1/chats/direct', ['user_id' => $other->id])->assertCreated();

    $response->assertJsonMissingPath('data.other_user.email')->assertJsonMissingPath('data.other_user.phone');
    expect($response->getContent())->not->toContain($other->email)->not->toContain('+66812345678');
});

it('rejects invalid targets', function (Closure $payload) {
    signIn();

    $this->postJson('/api/v1/chats/direct', $payload())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('user_id');
})->with([
    'missing' => fn () => [],
    'not a uuid' => fn () => ['user_id' => 'abc'],
    'unknown user' => fn () => ['user_id' => (string) Str::uuid()],
    'a deleted user' => function () {
        $gone = User::factory()->create();
        $gone->delete();

        return ['user_id' => $gone->id];
    },
]);

it('rejects chatting with yourself', function () {
    $me = signIn();

    $this->postJson('/api/v1/chats/direct', ['user_id' => $me->id])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('user_id');

    expect(Chat::count())->toBe(0);
});

it('requires authentication', function () {
    $this->postJson('/api/v1/chats/direct', ['user_id' => (string) Str::uuid()])->assertUnauthorized();
});
