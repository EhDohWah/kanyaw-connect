<?php

use App\Models\Chat;
use App\Models\User;
use Illuminate\Support\Str;

it('creates a group with the creator as owner', function () {
    $me = signIn();
    [$a, $b] = User::factory()->count(2)->create();

    $response = $this->postJson('/api/v1/chats/group', [
        'name' => 'Village council',
        'description' => 'Monthly meetings',
        'member_ids' => [$a->id, $b->id],
    ]);

    $response->assertCreated()
        ->assertJsonPath('data.type', 'group')
        ->assertJsonPath('data.name', 'Village council')
        ->assertJsonPath('data.member_count', 3)
        ->assertJsonPath('data.my_membership.role', 'owner')
        ->assertJsonCount(3, 'data.members');

    $roles = collect($response->json('data.members'))->pluck('role', 'user_id');
    expect($roles[$me->id])->toBe('owner')
        ->and($roles[$a->id])->toBe('member')
        ->and(Chat::first()->created_by)->toBe($me->id);
});

it('does not show the new members\' email or phone', function () {
    signIn();
    $a = User::factory()->create(['phone' => '+66812345678']);

    $response = $this->postJson('/api/v1/chats/group', ['name' => 'G', 'member_ids' => [$a->id]])->assertCreated();

    expect($response->getContent())->not->toContain($a->email)->not->toContain('+66812345678');
});

it('counts messages sent after joining as unread, but not the history before', function () {
    $owner = signIn();
    $member = User::factory()->create();
    $chatId = $this->postJson('/api/v1/chats/group', ['name' => 'G', 'member_ids' => [$member->id]])->json('data.id');

    addMessage(Chat::find($chatId), $owner);

    signIn($member);
    $this->getJson('/api/v1/chats')->assertJsonPath('data.0.unread_count', 1);
});

it('validates group input', function (array $payload, string $field) {
    signIn();
    $other = User::factory()->create();

    $payload = array_map(fn ($v) => $v === '{other}' ? $other->id : $v, $payload);
    if (isset($payload['member_ids'])) {
        $payload['member_ids'] = array_map(fn ($v) => $v === '{other}' ? $other->id : $v, $payload['member_ids']);
    }

    $this->postJson('/api/v1/chats/group', $payload)->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'no name' => [['member_ids' => ['{other}']], 'name'],
    'name too long' => [['name' => str_repeat('a', 101), 'member_ids' => ['{other}']], 'name'],
    'no members' => [['name' => 'G'], 'member_ids'],
    'empty members' => [['name' => 'G', 'member_ids' => []], 'member_ids'],
    'unknown member' => [['name' => 'G', 'member_ids' => ['b0b1a7e0-0000-4000-8000-000000000000']], 'member_ids.0'],
    'duplicate member' => [['name' => 'G', 'member_ids' => ['{other}', '{other}']], 'member_ids.0'],
    'bad uuid' => [['name' => 'G', 'member_ids' => ['nope']], 'member_ids.0'],
]);

it('rejects including yourself in member_ids', function () {
    $me = signIn();

    $this->postJson('/api/v1/chats/group', ['name' => 'G', 'member_ids' => [$me->id]])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('member_ids.0');
});

it('rejects more members than the group limit', function () {
    signIn();
    config(['chat.max_group_members' => 3]);

    $this->postJson('/api/v1/chats/group', [
        'name' => 'G',
        'member_ids' => [(string) Str::uuid(), (string) Str::uuid(), (string) Str::uuid()],
    ])->assertUnprocessable()->assertJsonValidationErrors('member_ids');
});

it('requires authentication', function () {
    $this->postJson('/api/v1/chats/group', [])->assertUnauthorized();
});
