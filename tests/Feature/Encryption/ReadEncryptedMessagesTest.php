<?php

use App\Models\Message;
use App\Models\MessageEnvelope;
use App\Models\User;

/*
| Alice (phone + laptop) and Bob (phone + laptop) in an encrypted chat. Every message from Alice's
| phone has an envelope for each of the other three devices. The key property under test: a device
| only ever sees ITS OWN envelope.
*/
beforeEach(function () {
    $this->alice = signIn();
    $this->bob = User::factory()->create();
    $this->alicePhone = makeDevice($this->alice);
    $this->aliceLaptop = makeDevice($this->alice);
    $this->bobPhone = makeDevice($this->bob);
    $this->bobLaptop = makeDevice($this->bob);
    $this->chat = makeEncryptedDirect($this->alice, $this->bob);

    // Three messages from Alice's phone, each with distinctive ciphertext per recipient device.
    $this->envelopes = [];
    foreach (range(1, 3) as $i) {
        $message = addMessage($this->chat, $this->alice, ['content' => null, 'metadata' => ['sender_device_id' => $this->alicePhone->id], 'created_at' => now()->subMinutes(10 - $i)]);
        foreach ([$this->aliceLaptop, $this->bobPhone, $this->bobLaptop] as $device) {
            $this->envelopes[$message->id][$device->id] = MessageEnvelope::create([
                'message_id' => $message->id,
                'recipient_device_id' => $device->id,
                'ciphertext' => "ciphertext-m{$i}-for-{$device->id}",
                'header' => ['n' => "nonce-{$i}", 'for' => $device->id],
            ]);
        }
    }
});

function listAs($test, $chat, $device, string $query = '')
{
    return $test->withHeader('X-Device-Id', $device->id)->getJson("/api/v1/chats/{$chat->id}/messages{$query}");
}

it('returns only the calling device\'s own envelope for each message', function () {
    signIn($this->bob);

    $rows = listAs($this, $this->chat, $this->bobPhone)->assertOk()->assertJsonCount(3, 'data')->json('data');

    foreach ($rows as $row) {
        expect($row['envelope']['recipient_device_id'])->toBe($this->bobPhone->id)
            ->and($row['envelope']['ciphertext'])->toBe($this->envelopes[$row['id']][$this->bobPhone->id]->ciphertext)
            ->and($row['envelope']['header'])->toBe($this->envelopes[$row['id']][$this->bobPhone->id]->header)
            ->and($row['content'])->toBeNull()
            ->and($row['encrypted'])->toBeTrue()
            ->and($row['metadata']['sender_device_id'])->toBe($this->alicePhone->id);
    }
});

it('never includes another device\'s ciphertext, even another device of the same user', function () {
    signIn($this->bob);

    $content = listAs($this, $this->chat, $this->bobPhone)->assertOk()->getContent();

    foreach ([$this->aliceLaptop, $this->bobLaptop] as $other) {
        expect($content)->not->toContain('for-'.$other->id);
    }
    expect($content)->toContain('for-'.$this->bobPhone->id);
});

it('gives each of a user\'s devices its own copy', function () {
    $phone = listAs($this, $this->chat, $this->aliceLaptop)->assertOk()->json('data.0.envelope.ciphertext');

    signIn($this->bob);
    $bobsLaptop = listAs($this, $this->chat, $this->bobLaptop)->assertOk()->json('data.0.envelope.ciphertext');

    expect($phone)->toContain('for-'.$this->aliceLaptop->id)
        ->and($bobsLaptop)->toContain('for-'.$this->bobLaptop->id)
        ->and($phone)->not->toBe($bobsLaptop);
});

it('shows a null envelope for messages this device cannot read', function () {
    // The sending phone kept no envelope for itself, and a device added later has none either.
    $rows = listAs($this, $this->chat, $this->alicePhone)->assertOk()->json('data');
    expect(collect($rows)->pluck('envelope')->filter()->all())->toBe([]);

    $later = makeDevice($this->alice);
    $rows = listAs($this, $this->chat, $later)->assertOk()->json('data');
    expect($rows)->toHaveCount(3)->and(collect($rows)->every(fn ($r) => array_key_exists('envelope', $r) && $r['envelope'] === null))->toBeTrue();
});

it('keeps the header exactly as the sender wrote it, including key order', function () {
    $message = Message::where('chat_id', $this->chat->id)->first();
    $envelope = $this->envelopes[$message->id][$this->bobPhone->id];
    DB::table('message_envelopes')->where('id', $envelope->id)->update(['header' => '{"z":1,"a":2,"m":{"y":true,"b":null}}']);
    signIn($this->bob);

    $content = listAs($this, $this->chat, $this->bobPhone)->assertOk()->getContent();

    expect($content)->toContain('"header":{"z":1,"a":2,"m":{"y":true,"b":null}}');
});

describe('which device is asking', function () {
    it('requires the X-Device-Id header in an encrypted chat', function () {
        $this->getJson("/api/v1/chats/{$this->chat->id}/messages")
            ->assertUnprocessable()->assertJsonValidationErrors('X-Device-Id');
    });

    it('refuses another user\'s device, so nobody can fetch envelopes meant for someone else', function () {
        // Alice asks as if she were Bob's phone.
        $this->withHeader('X-Device-Id', $this->bobPhone->id)->getJson("/api/v1/chats/{$this->chat->id}/messages")
            ->assertForbidden()
            ->assertJsonMissingPath('data');
    });

    it('refuses that on a single message too', function () {
        $message = Message::where('chat_id', $this->chat->id)->first();

        $this->withHeader('X-Device-Id', $this->bobPhone->id)->getJson("/api/v1/messages/{$message->id}")->assertForbidden();
    });

    it('refuses a revoked device', function () {
        $this->aliceLaptop->update(['revoked_at' => now()]);

        listAs($this, $this->chat, $this->aliceLaptop)->assertForbidden();
    });

    it('refuses a device id that does not exist or is not a UUID', function (string $id) {
        $this->withHeader('X-Device-Id', $id)->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertForbidden();
    })->with(['not-a-uuid', "'; drop table devices;--", '00000000-0000-0000-0000-000000000000']);

    it('refuses someone who is not in the chat, whatever device they name', function () {
        $stranger = signIn(User::factory()->create());
        $device = makeDevice($stranger);

        listAs($this, $this->chat, $device)->assertForbidden();
        $this->withHeader('X-Device-Id', $this->bobPhone->id)->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertForbidden();
    });
});

describe('a single message', function () {
    it('returns the calling device\'s envelope', function () {
        signIn($this->bob);
        $message = Message::where('chat_id', $this->chat->id)->first();

        $this->withHeader('X-Device-Id', $this->bobLaptop->id)->getJson("/api/v1/messages/{$message->id}")
            ->assertOk()
            ->assertJsonPath('data.id', $message->id)
            ->assertJsonPath('data.envelope.recipient_device_id', $this->bobLaptop->id)
            ->assertJsonPath('data.envelope.ciphertext', $this->envelopes[$message->id][$this->bobLaptop->id]->ciphertext);
    });

    it('needs the device header in an encrypted chat', function () {
        $message = Message::where('chat_id', $this->chat->id)->first();

        $this->getJson("/api/v1/messages/{$message->id}")->assertUnprocessable();
    });

    it('is for members only', function () {
        $message = Message::where('chat_id', $this->chat->id)->first();
        $stranger = signIn(User::factory()->create());

        $this->withHeader('X-Device-Id', makeDevice($stranger)->id)->getJson("/api/v1/messages/{$message->id}")->assertForbidden();
    });

    it('is gone once deleted', function () {
        $message = Message::where('chat_id', $this->chat->id)->first();
        $message->delete();

        $this->withHeader('X-Device-Id', $this->alicePhone->id)->getJson("/api/v1/messages/{$message->id}")->assertNotFound();
    });

    it('works for plaintext messages without a device', function () {
        $plain = makeDirect($this->alice, User::factory()->create());
        $message = addMessage($plain, $this->alice, ['content' => 'hello']);

        $this->getJson("/api/v1/messages/{$message->id}")
            ->assertOk()->assertJsonPath('data.content', 'hello')->assertJsonPath('data.encrypted', false)->assertJsonMissingPath('data.envelope');
    });
});

describe('plaintext chats', function () {
    it('need no device header and ignore one', function () {
        $plain = makeDirect($this->alice, User::factory()->create());
        addMessage($plain, $this->alice, ['content' => 'hi']);

        $this->getJson("/api/v1/chats/{$plain->id}/messages")->assertOk()->assertJsonPath('data.0.content', 'hi')->assertJsonMissingPath('data.0.envelope');
        $this->withHeader('X-Device-Id', 'anything')->getJson("/api/v1/chats/{$plain->id}/messages")->assertOk();
    });
});

describe('the chat list', function () {
    it('gives the latest message\'s envelope for the calling device when it names itself', function () {
        signIn($this->bob);
        $latest = Message::where('chat_id', $this->chat->id)->orderByDesc('created_at')->first();

        $row = $this->withHeader('X-Device-Id', $this->bobPhone->id)->getJson('/api/v1/chats')->assertOk()->json('data.0');

        expect($row['latest_message']['id'])->toBe($latest->id)
            ->and($row['latest_message']['content'])->toBeNull()
            ->and($row['latest_message']['encrypted'])->toBeTrue()
            ->and($row['latest_message']['envelope']['recipient_device_id'])->toBe($this->bobPhone->id)
            ->and($row['latest_message']['envelope']['ciphertext'])->toBe($this->envelopes[$latest->id][$this->bobPhone->id]->ciphertext);
    });

    it('leaves envelopes out when no device is named', function () {
        $this->getJson('/api/v1/chats')->assertOk()->assertJsonMissingPath('data.0.latest_message.envelope')->assertJsonPath('data.0.latest_message.encrypted', true);
    });

    it('refuses a device that is not mine, instead of listing someone else\'s envelopes', function () {
        $this->withHeader('X-Device-Id', $this->bobPhone->id)->getJson('/api/v1/chats')->assertForbidden();
    });

    it('also works on the single chat', function () {
        $this->withHeader('X-Device-Id', $this->aliceLaptop->id)->getJson("/api/v1/chats/{$this->chat->id}")
            ->assertOk()->assertJsonPath('data.latest_message.envelope.recipient_device_id', $this->aliceLaptop->id);
    });

    it('does not mix envelopes between chats', function () {
        $other = makeEncryptedDirect($this->alice, User::factory()->create());
        $message = addMessage($other, $this->alice, ['content' => null, 'metadata' => ['sender_device_id' => $this->alicePhone->id], 'created_at' => now()->addMinute()]);
        MessageEnvelope::create(['message_id' => $message->id, 'recipient_device_id' => $this->aliceLaptop->id, 'ciphertext' => 'OTHER-CHAT', 'header' => ['a' => 1]]);

        $rows = collect($this->withHeader('X-Device-Id', $this->aliceLaptop->id)->getJson('/api/v1/chats')->assertOk()->json('data'))->keyBy('id');

        expect($rows[$other->id]['latest_message']['envelope']['ciphertext'])->toBe('OTHER-CHAT')
            ->and($rows[$this->chat->id]['latest_message']['envelope']['ciphertext'])->toContain('for-'.$this->aliceLaptop->id);
    });

    it('uses the same number of queries for 2 encrypted chats and for 14', function () {
        $seed = function (int $n) {
            foreach (range(1, $n) as $_) {
                $other = User::factory()->create();
                $chat = makeEncryptedDirect($this->alice, $other);
                $message = addMessage($chat, $other, ['content' => null, 'metadata' => ['sender_device_id' => makeDevice($other)->id]]);
                MessageEnvelope::create(['message_id' => $message->id, 'recipient_device_id' => $this->aliceLaptop->id, 'ciphertext' => 'c', 'header' => ['a' => 1]]);
            }
        };

        $this->aliceLaptop->update(['last_active_at' => now()]); // skip the once-per-5-minutes activity update
        $seed(2);
        $few = countQueries(fn () => $this->withHeader('X-Device-Id', $this->aliceLaptop->id)->getJson('/api/v1/chats')->assertOk());

        $seed(12);
        $many = countQueries(fn () => $this->withHeader('X-Device-Id', $this->aliceLaptop->id)->getJson('/api/v1/chats?per_page=50')->assertOk());

        expect($many)->toBe($few);
    });
});

it('uses the same number of queries for 3 messages and for 30', function () {
    $this->aliceLaptop->update(['last_active_at' => now()]); // skip the once-per-5-minutes activity update
    $few = countQueries(fn () => listAs($this, $this->chat, $this->aliceLaptop)->assertOk()->assertJsonCount(3, 'data'));

    foreach (range(1, 27) as $i) {
        $message = addMessage($this->chat, $this->alice, ['content' => null, 'metadata' => ['sender_device_id' => $this->alicePhone->id], 'created_at' => now()->subHours($i)]);
        MessageEnvelope::create(['message_id' => $message->id, 'recipient_device_id' => $this->aliceLaptop->id, 'ciphertext' => "c{$i}", 'header' => ['a' => 1]]);
    }
    $many = countQueries(fn () => listAs($this, $this->chat, $this->aliceLaptop, '?per_page=30')->assertOk()->assertJsonCount(30, 'data'));

    expect($many)->toBe($few);
});

it('pages through encrypted history with cursors, keeping the per-device envelopes', function () {
    foreach (range(1, 5) as $i) {
        $message = addMessage($this->chat, $this->alice, ['content' => null, 'metadata' => ['sender_device_id' => $this->alicePhone->id], 'created_at' => now()->subDays($i)]);
        MessageEnvelope::create(['message_id' => $message->id, 'recipient_device_id' => $this->aliceLaptop->id, 'ciphertext' => "old-{$i}", 'header' => ['a' => 1]]);
    }

    $seen = collect();
    $url = "/api/v1/chats/{$this->chat->id}/messages?per_page=3";
    do {
        $page = $this->withHeader('X-Device-Id', $this->aliceLaptop->id)->getJson($url)->assertOk();
        $seen = $seen->merge($page->json('data'));
        $url = $page->json('links.next');
    } while ($url);

    expect($seen)->toHaveCount(8)->and($seen->pluck('id')->unique())->toHaveCount(8)
        ->and($seen->every(fn ($row) => ($row['envelope']['recipient_device_id'] ?? $this->aliceLaptop->id) === $this->aliceLaptop->id))->toBeTrue();
});
