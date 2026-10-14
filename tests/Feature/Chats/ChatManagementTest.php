<?php

use App\Enums\ChatRole;
use App\Models\Chat;
use App\Models\User;

describe('updating a chat', function () {
    it('lets the owner and admins rename a group', function (string $who) {
        [$owner, $admin] = User::factory()->count(2)->create();
        $chat = makeGroup($owner, [], [$admin]);

        signIn($who === 'owner' ? $owner : $admin);

        $this->patchJson("/api/v1/chats/{$chat->id}", ['name' => 'New name', 'description' => 'New description'])
            ->assertOk()
            ->assertJsonPath('data.name', 'New name')
            ->assertJsonPath('data.description', 'New description');

        expect($chat->fresh()->name)->toBe('New name');
    })->with(['owner', 'admin']);

    it('forbids plain members', function () {
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $chat = makeGroup($owner, [$member], [], ['name' => 'Original']);

        signIn($member);
        $this->patchJson("/api/v1/chats/{$chat->id}", ['name' => 'Hijacked'])->assertForbidden();

        expect($chat->fresh()->name)->toBe('Original');
    });

    it('forbids renaming a direct chat', function () {
        $me = signIn();
        $chat = makeDirect($me, User::factory()->create());

        $this->patchJson("/api/v1/chats/{$chat->id}", ['name' => 'x'])->assertForbidden();
    });

    it('validates the name', function () {
        $me = signIn();
        $chat = makeGroup($me);

        $this->patchJson("/api/v1/chats/{$chat->id}", ['name' => ''])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->patchJson("/api/v1/chats/{$chat->id}", ['name' => str_repeat('a', 101)])->assertUnprocessable();
    });

    it('can clear the description', function () {
        $me = signIn();
        $chat = makeGroup($me, [], [], ['description' => 'old']);

        $this->patchJson("/api/v1/chats/{$chat->id}", ['description' => null])->assertOk()->assertJsonPath('data.description', null);
    });

    it('does not change protected fields', function () {
        $me = signIn();
        $chat = makeGroup($me);

        $this->patchJson("/api/v1/chats/{$chat->id}", ['is_encrypted' => true, 'type' => 'direct', 'member_count' => 99])->assertOk();

        expect($chat->fresh())->is_encrypted->toBeFalse()->type->value->toBe('group')->member_count->toBe(1);
    });
});

describe('leaving a chat', function () {
    it('lets a member leave a group', function () {
        $owner = User::factory()->create();
        $me = signIn();
        $chat = makeGroup($owner, [$me]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();

        expect($chat->chatMembers()->where('user_id', $me->id)->exists())->toBeFalse()
            ->and($chat->fresh()->member_count)->toBe(1);
        $this->getJson('/api/v1/chats')->assertJsonCount(0, 'data');
    });

    it('hands ownership to the longest-standing admin when the owner leaves', function () {
        $owner = signIn();
        [$member, $admin] = User::factory()->count(2)->create();
        // Members joined before the admin here, to show that admins win over seniority.
        $chat = makeGroup($owner, [$member], [$admin]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();

        expect($chat->membershipOf($admin)->fresh()->role)->toBe(ChatRole::Owner)
            ->and($chat->membershipOf($member)->fresh()->role)->toBe(ChatRole::Member)
            ->and($chat->fresh()->member_count)->toBe(2);
    });

    it('hands ownership to the longest-standing member when there is no admin', function () {
        $owner = signIn();
        [$first, $second] = User::factory()->count(2)->create();
        $chat = makeGroup($owner, [$first, $second]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();

        expect($chat->membershipOf($first)->fresh()->role)->toBe(ChatRole::Owner)
            ->and($chat->membershipOf($second)->fresh()->role)->toBe(ChatRole::Member);
    });

    it('deletes the chat when the last member leaves', function () {
        $me = signIn();
        $chat = makeGroup($me);

        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();

        expect(Chat::find($chat->id))->toBeNull()->and(Chat::withTrashed()->find($chat->id))->not->toBeNull();
    });

    it('is forbidden the second time, once they are no longer a member', function () {
        $owner = User::factory()->create();
        $me = signIn();
        $chat = makeGroup($owner, [$me]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();
        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertForbidden();
        expect($chat->fresh()->member_count)->toBe(1);
    });

    it('is not allowed in a direct chat', function () {
        $me = signIn();
        $chat = makeDirect($me, User::factory()->create());

        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertForbidden();
        expect($chat->chatMembers()->count())->toBe(2);
    });
});
