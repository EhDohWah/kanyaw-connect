<?php

use App\Enums\ChatRole;
use App\Models\User;
use Illuminate\Support\Str;

describe('adding members', function () {
    it('lets the owner and admins add users', function (string $who) {
        [$owner, $admin] = User::factory()->count(2)->create();
        $newcomers = User::factory()->count(2)->create();
        $chat = makeGroup($owner, [], [$admin]);

        signIn($who === 'owner' ? $owner : $admin);

        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => $newcomers->pluck('id')->all()])
            ->assertOk()
            ->assertJsonPath('data.member_count', 4)
            ->assertJsonCount(4, 'data.members');

        expect($chat->fresh()->member_count)->toBe(4);
        foreach ($newcomers as $user) {
            expect($chat->membershipOf($user)?->role)->toBe(ChatRole::Member);
        }
    })->with(['owner', 'admin']);

    it('forbids plain members', function () {
        $owner = User::factory()->create();
        $member = User::factory()->create();
        $chat = makeGroup($owner, [$member]);

        signIn($member);
        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => [User::factory()->create()->id]])->assertForbidden();
        expect($chat->fresh()->member_count)->toBe(2);
    });

    it('forbids adding to a direct chat', function () {
        $me = signIn();
        $chat = makeDirect($me, User::factory()->create());

        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => [User::factory()->create()->id]])->assertForbidden();
    });

    it('skips users who are already members', function () {
        $owner = signIn();
        $member = User::factory()->create();
        $chat = makeGroup($owner, [$member]);

        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => [$member->id, $owner->id]])
            ->assertOk()
            ->assertJsonPath('data.member_count', 2);

        expect($chat->chatMembers()->count())->toBe(2)
            ->and($chat->membershipOf($owner)->role)->toBe(ChatRole::Owner);
    });

    it('does not show the history to new members as unread', function () {
        $owner = signIn();
        $chat = makeGroup($owner);
        addMessage($chat, $owner, ['created_at' => now()->subHour()]);
        $newcomer = User::factory()->create();

        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => [$newcomer->id]])->assertOk();

        expect($chat->fresh()->unreadCountFor($newcomer))->toBe(0);
    });

    it('lets someone who left be added again', function () {
        $owner = signIn();
        $leaver = User::factory()->create();
        $chat = makeGroup($owner, [$leaver]);

        signIn($leaver);
        $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();

        signIn($owner);
        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => [$leaver->id]])->assertOk();
        expect($chat->fresh()->member_count)->toBe(2);
    });

    it('enforces the group size limit', function () {
        $owner = signIn();
        config(['chat.max_group_members' => 3]);
        $chat = makeGroup($owner, [User::factory()->create()]);
        $extra = User::factory()->count(2)->create();

        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => $extra->pluck('id')->all()])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('user_ids');

        expect($chat->fresh()->member_count)->toBe(2);
    });

    it('validates the user ids', function (array $ids) {
        $owner = signIn();
        $chat = makeGroup($owner);

        $this->postJson("/api/v1/chats/{$chat->id}/members", ['user_ids' => $ids])->assertUnprocessable();
    })->with([
        'empty' => [[]],
        'unknown user' => [[(string) Str::uuid()]],
        'not a uuid' => [['nope']],
    ]);
});

describe('removing members', function () {
    it('lets the owner remove an admin or a member', function (string $targetRole) {
        $owner = signIn();
        $target = User::factory()->create();
        $chat = $targetRole === 'admin' ? makeGroup($owner, [], [$target]) : makeGroup($owner, [$target]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/members/{$target->id}")->assertNoContent();

        expect($chat->membershipOf($target))->toBeNull() // fresh instance of the policy cache is per request
            ->and($chat->chatMembers()->where('user_id', $target->id)->exists())->toBeFalse()
            ->and($chat->fresh()->member_count)->toBe(1);
    })->with(['admin', 'member']);

    it('lets an admin remove a plain member', function () {
        $owner = User::factory()->create();
        $admin = signIn();
        $member = User::factory()->create();
        $chat = makeGroup($owner, [$member], [$admin]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/members/{$member->id}")->assertNoContent();
        expect($chat->fresh()->member_count)->toBe(2);
    });

    it('stops an admin removing another admin or the owner', function (string $target) {
        $owner = User::factory()->create();
        $admin = signIn();
        $otherAdmin = User::factory()->create();
        $chat = makeGroup($owner, [], [$admin, $otherAdmin]);

        $victim = $target === 'owner' ? $owner : $otherAdmin;
        $this->deleteJson("/api/v1/chats/{$chat->id}/members/{$victim->id}")->assertForbidden();

        expect($chat->fresh()->member_count)->toBe(3);
    })->with(['owner', 'admin']);

    it('forbids plain members', function () {
        $owner = User::factory()->create();
        $me = signIn();
        $other = User::factory()->create();
        $chat = makeGroup($owner, [$me, $other]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/members/{$other->id}")->assertForbidden();
    });

    it('tells people to use leave when removing themselves', function () {
        $owner = signIn();
        $chat = makeGroup($owner, [User::factory()->create()]);

        $this->deleteJson("/api/v1/chats/{$chat->id}/members/{$owner->id}")->assertForbidden();
        expect($chat->fresh()->member_count)->toBe(2);
    });

    it('returns 404 for a user who is not in the chat', function () {
        $owner = signIn();
        $chat = makeGroup($owner);
        $stranger = User::factory()->create();

        $this->deleteJson("/api/v1/chats/{$chat->id}/members/{$stranger->id}")->assertNotFound();
    });

    it('is not possible in a direct chat', function () {
        $me = signIn();
        $other = User::factory()->create();
        $chat = makeDirect($me, $other);

        $this->deleteJson("/api/v1/chats/{$chat->id}/members/{$other->id}")->assertForbidden();
        expect($chat->chatMembers()->count())->toBe(2);
    });
});

describe('changing roles', function () {
    it('lets the owner promote and demote', function () {
        $owner = signIn();
        $member = User::factory()->create();
        $chat = makeGroup($owner, [$member]);

        $this->patchJson("/api/v1/chats/{$chat->id}/members/{$member->id}", ['role' => 'admin'])->assertOk();
        expect($chat->chatMembers()->where('user_id', $member->id)->first()->role)->toBe(ChatRole::Admin);

        $this->patchJson("/api/v1/chats/{$chat->id}/members/{$member->id}", ['role' => 'member'])->assertOk();
        expect($chat->chatMembers()->where('user_id', $member->id)->first()->role)->toBe(ChatRole::Member);
    });

    it('forbids admins and members from changing roles', function (string $actorRole) {
        $owner = User::factory()->create();
        $actor = signIn();
        $target = User::factory()->create();
        $chat = $actorRole === 'admin' ? makeGroup($owner, [$target], [$actor]) : makeGroup($owner, [$target, $actor]);

        $this->patchJson("/api/v1/chats/{$chat->id}/members/{$target->id}", ['role' => 'admin'])->assertForbidden();
        expect($chat->chatMembers()->where('user_id', $target->id)->first()->role)->toBe(ChatRole::Member);
    })->with(['admin', 'member']);

    it('never changes the owner\'s role', function () {
        $owner = signIn();
        $chat = makeGroup($owner, [User::factory()->create()]);

        $this->patchJson("/api/v1/chats/{$chat->id}/members/{$owner->id}", ['role' => 'member'])->assertForbidden();
        expect($chat->membershipOf($owner)->fresh()->role)->toBe(ChatRole::Owner);
    });

    it('rejects the owner role and unknown roles', function (string $role) {
        $owner = signIn();
        $member = User::factory()->create();
        $chat = makeGroup($owner, [$member]);

        $this->patchJson("/api/v1/chats/{$chat->id}/members/{$member->id}", ['role' => $role])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role');
    })->with(['owner', 'superuser', '']);

    it('returns 404 for a user who is not in the chat', function () {
        $owner = signIn();
        $chat = makeGroup($owner);

        $this->patchJson("/api/v1/chats/{$chat->id}/members/".User::factory()->create()->id, ['role' => 'admin'])->assertNotFound();
    });

    it('is not possible in a direct chat', function () {
        $me = signIn();
        $other = User::factory()->create();
        $chat = makeDirect($me, $other);

        $this->patchJson("/api/v1/chats/{$chat->id}/members/{$other->id}", ['role' => 'admin'])->assertForbidden();
    });
});
