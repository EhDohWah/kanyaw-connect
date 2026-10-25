<?php

use App\Models\Attachment;
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

describe('voice messages: length and waveform', function () {
    beforeEach(function () {
        $this->voice = fn (array $metadata = [], string $type = 'voice', ?Chat $chat = null) => $this->postJson(
            '/api/v1/chats/'.($chat ?? $this->chat)->id.'/messages',
            sendPayload(['type' => $type, 'content' => null, 'metadata' => array_merge([
                'attachment_id' => Attachment::factory()->create([
                    'chat_id' => ($chat ?? $this->chat)->id,
                    'uploader_id' => $this->me->id,
                    'mime_type' => $type === 'voice' ? 'audio/webm' : 'image/png',
                ])->id,
            ], $metadata)]),
        );
    });

    it('stores duration_ms and waveform as sent and returns them (also on the event and in lists)', function () {
        $waveform = array_map(fn (int $i) => ($i * 37) % 256, range(0, 47));

        $response = ($this->voice)(['duration_ms' => 4200, 'waveform' => $waveform])
            ->assertCreated()
            ->assertJsonPath('data.metadata.duration_ms', 4200)
            ->assertJsonPath('data.metadata.waveform', $waveform);

        expect(Message::find($response->json('data.id'))->metadata)
            ->toMatchArray(['duration_ms' => 4200, 'waveform' => $waveform]);
        $this->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertJsonPath('data.0.metadata.waveform', $waveform);
    });

    it('takes either, or neither (files sent before, or from apps that do not measure)', function () {
        ($this->voice)(['duration_ms' => 1])->assertCreated()->assertJsonMissingPath('data.metadata.waveform');
        ($this->voice)(['waveform' => array_fill(0, 16, 0)])->assertCreated()->assertJsonMissingPath('data.metadata.duration_ms');
        ($this->voice)()->assertCreated()->assertJsonMissingPath('data.metadata.duration_ms');
    });

    it('accepts the limits exactly', function () {
        ($this->voice)(['duration_ms' => 600000, 'waveform' => array_fill(0, 64, 255)])->assertCreated();
        ($this->voice)(['duration_ms' => 1, 'waveform' => array_fill(0, 16, 0)])->assertCreated();
    });

    it('refuses what is out of range', function (array $metadata, string $field) {
        ($this->voice)($metadata)->assertUnprocessable()->assertJsonValidationErrors($field);
        expect(Message::count())->toBe(0);
    })->with([
        'no length' => [['duration_ms' => 0], 'metadata.duration_ms'],
        'longer than 10 minutes' => [['duration_ms' => 600001], 'metadata.duration_ms'],
        'a length as text' => [['duration_ms' => '4200'], 'metadata.duration_ms'],
        'a fractional length' => [['duration_ms' => 4200.5], 'metadata.duration_ms'],
        'too few bars' => [['waveform' => array_fill(0, 15, 1)], 'metadata.waveform'],
        'too many bars' => [['waveform' => array_fill(0, 65, 1)], 'metadata.waveform'],
        'a bar over 255' => [['waveform' => [...array_fill(0, 20, 1), 256]], 'metadata.waveform.20'],
        'a negative bar' => [['waveform' => [-1, ...array_fill(0, 20, 1)]], 'metadata.waveform.0'],
        'a bar as text' => [['waveform' => ['7', ...array_fill(0, 20, 1)]], 'metadata.waveform.0'],
        'an object, not a list' => [['waveform' => array_combine(array_map(fn ($i) => "k{$i}", range(1, 20)), array_fill(0, 20, 1))], 'metadata.waveform'],
    ]);

    it('other message types still take only attachment_id', function () {
        ($this->voice)(['duration_ms' => 4200], 'image')->assertUnprocessable()->assertJsonValidationErrors('metadata');
        ($this->voice)(['waveform' => array_fill(0, 20, 1)], 'image')->assertUnprocessable()->assertJsonValidationErrors('metadata');
    });

    it('voice messages take nothing else either', function () {
        ($this->voice)(['duration_ms' => 4200, 'transcript' => 'hello'])->assertUnprocessable()->assertJsonValidationErrors('metadata');
    });

    it('not in an encrypted chat, where they would tell the server about what was said', function () {
        $device = makeDevice($this->me);
        $friend = User::factory()->create();
        $chat = makeEncryptedDirect($this->me, $friend);
        $attachment = Attachment::factory()->create(['chat_id' => $chat->id, 'uploader_id' => $this->me->id]);

        $this->postJson("/api/v1/chats/{$chat->id}/messages", [
            'client_id' => (string) Str::uuid(),
            'type' => 'voice',
            'metadata' => ['attachment_id' => $attachment->id, 'duration_ms' => 4200],
            'envelopes' => envelopesFor([makeDevice($friend)]),
        ], ['X-Device-Id' => $device->id])->assertUnprocessable()->assertJsonValidationErrors('metadata');
    });
});
