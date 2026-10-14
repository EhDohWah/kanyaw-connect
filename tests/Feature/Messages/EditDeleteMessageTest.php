<?php

use App\Models\Message;
use App\Models\User;

beforeEach(function () {
    $this->owner = User::factory()->create();
    $this->admin = User::factory()->create();
    $this->member = User::factory()->create();
    $this->other = User::factory()->create();
    $this->chat = makeGroup($this->owner, [$this->member, $this->other], [$this->admin]);
});

describe('editing', function () {
    it('lets the sender edit within 24 hours', function () {
        $message = addMessage($this->chat, $this->member, ['content' => 'typo', 'created_at' => now()->subHours(23)]);
        signIn($this->member);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'fixed'])
            ->assertOk()
            ->assertJsonPath('data.content', 'fixed')
            ->assertJsonPath('data.is_edited', true);

        $fresh = $message->fresh();
        expect($fresh->is_edited)->toBeTrue()->and($fresh->edited_at)->not->toBeNull();
    });

    it('forbids editing after 24 hours', function () {
        $message = addMessage($this->chat, $this->member, ['content' => 'old', 'created_at' => now()->subHours(25)]);
        signIn($this->member);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'late'])->assertForbidden();
        expect($message->fresh()->content)->toBe('old');
    });

    it('forbids editing someone else\'s message, even for admins and owners', function (string $who) {
        $message = addMessage($this->chat, $this->member, ['content' => 'mine']);
        signIn($this->{$who});

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'hijacked'])->assertForbidden();
        expect($message->fresh()->content)->toBe('mine');
    })->with(['owner', 'admin', 'other']);

    it('forbids editing system messages', function () {
        $message = addMessage($this->chat, null, ['type' => 'system', 'content' => 'created']);
        signIn($this->owner);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'x'])->assertForbidden();
    });

    it('does not allow emptying a text message', function () {
        $message = addMessage($this->chat, $this->member, ['content' => 'keep']);
        signIn($this->member);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => ''])->assertUnprocessable()->assertJsonValidationErrors('content');
        $this->patchJson("/api/v1/messages/{$message->id}", [])->assertUnprocessable();
    });

    it('allows a media message to lose its caption', function () {
        $message = addMessage($this->chat, $this->member, ['type' => 'file', 'content' => 'caption']);
        signIn($this->member);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => null])->assertOk()->assertJsonPath('data.content', null);
    });

    it('cannot edit a deleted message', function () {
        $message = addMessage($this->chat, $this->member);
        $message->delete();
        signIn($this->member);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'x'])->assertNotFound();
    });

    it('ignores attempts to change anything but content', function () {
        $message = addMessage($this->chat, $this->member, ['content' => 'a']);
        signIn($this->member);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'b', 'sender_id' => $this->owner->id, 'type' => 'system'])->assertOk();

        expect($message->fresh())->sender_id->toBe($this->member->id)->type->value->toBe('text');
    });
});

describe('deleting', function () {
    it('lets the sender delete their message', function () {
        $message = addMessage($this->chat, $this->member);
        signIn($this->member);

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();

        expect(Message::find($message->id))->toBeNull()->and(Message::withTrashed()->find($message->id))->not->toBeNull();
    });

    it('lets the sender delete an old message (no time limit on deleting)', function () {
        $message = addMessage($this->chat, $this->member, ['created_at' => now()->subDays(10)]);
        signIn($this->member);

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();
    });

    it('lets admins and the owner delete anyone\'s message', function (string $who) {
        $message = addMessage($this->chat, $this->member);
        signIn($this->{$who});

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();
        expect(Message::find($message->id))->toBeNull();
    })->with(['owner', 'admin']);

    it('forbids other members', function () {
        $message = addMessage($this->chat, $this->member);
        signIn($this->other);

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertForbidden();
        expect(Message::find($message->id))->not->toBeNull();
    });

    it('removes the message from the list', function () {
        $message = addMessage($this->chat, $this->member);
        signIn($this->member);
        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();

        $this->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertJsonCount(0, 'data');
    });

    it('returns 404 the second time', function () {
        $message = addMessage($this->chat, $this->member);
        signIn($this->member);
        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNotFound();
    });

    it('lets a direct-chat participant delete only their own messages', function () {
        $a = $this->member;
        $b = $this->other;
        $direct = makeDirect($a, $b);
        $theirs = addMessage($direct, $b);
        signIn($a);

        $this->deleteJson("/api/v1/messages/{$theirs->id}")->assertForbidden();
    });
});

it('answers 404, not a server error, for messages of a chat that no longer exists', function () {
    $lonely = User::factory()->create();
    $chat = makeGroup($lonely);
    $message = addMessage($chat, $lonely);

    signIn($lonely);
    $this->deleteJson("/api/v1/chats/{$chat->id}/leave")->assertNoContent();

    signIn($this->member);
    $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'x'])->assertNotFound();
    $this->deleteJson("/api/v1/messages/{$message->id}")->assertNotFound();
});
