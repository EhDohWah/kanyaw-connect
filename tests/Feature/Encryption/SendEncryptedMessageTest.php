<?php

use App\Events\MessageSent;
use App\Models\Chat;
use App\Models\Message;
use App\Models\MessageEnvelope;
use App\Models\User;
use Illuminate\Support\Str;

/*
| Setup: Alice (2 devices) and Bob (2 devices) in an encrypted direct chat, Carol (1 device) joins
| for the group tests. Alice sends from her phone.
*/
beforeEach(function () {
    $this->alice = signIn();
    $this->bob = User::factory()->create();
    $this->carol = User::factory()->create();

    $this->alicePhone = makeDevice($this->alice);
    $this->aliceLaptop = makeDevice($this->alice);
    $this->bobPhone = makeDevice($this->bob);
    $this->bobLaptop = makeDevice($this->bob);
    $this->carolPhone = makeDevice($this->carol);

    $this->chat = makeEncryptedDirect($this->alice, $this->bob);
    // Everyone's devices except the sending phone need an envelope.
    $this->needed = [$this->aliceLaptop, $this->bobPhone, $this->bobLaptop];
});

it('stores one envelope per recipient device and no content', function () {
    $envelopes = envelopesFor($this->needed);

    $response = sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)
        ->assertCreated()
        ->assertJsonPath('data.content', null)
        ->assertJsonPath('data.encrypted', true)
        ->assertJsonPath('data.type', 'text')
        ->assertJsonPath('data.sender.id', $this->alice->id)
        ->assertJsonPath('data.metadata.sender_device_id', $this->alicePhone->id)
        ->assertJsonPath('data.envelope', null);

    $message = Message::findOrFail($response->json('data.id'));
    expect($message->content)->toBeNull()
        ->and($message->envelopes()->count())->toBe(3)
        ->and($message->envelopes()->pluck('recipient_device_id')->sort()->values()->all())
        ->toBe(collect($this->needed)->pluck('id')->sort()->values()->all());
});

it('stores ciphertext and header exactly as sent and never returns them to the sender', function () {
    $envelopes = envelopesFor($this->needed);
    // Leading and trailing whitespace, control characters and odd text: all must survive untouched.
    $envelopes[0]['ciphertext'] = "  \t<?php system('x'); ?> ✓ 日本語 \u{1F512} ".str_repeat('=+/', 20)." \n";
    $envelopes[0]['header'] = ['z_last' => 1, 'a_first' => ['nested' => true], 'prekey_id' => 7, 'n' => 1.50, 'empty' => '', 'padded' => ' x '];

    $response = sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertCreated();

    $stored = MessageEnvelope::where('message_id', $response->json('data.id'))->where('recipient_device_id', $envelopes[0]['recipient_device_id'])->firstOrFail();
    expect($stored->ciphertext)->toBe($envelopes[0]['ciphertext'])
        ->and($stored->header)->toBe($envelopes[0]['header'])
        ->and(DB::table('message_envelopes')->where('id', $stored->id)->value('header'))->toBe(json_encode($envelopes[0]['header']));
    expect($response->getContent())->not->toContain('ciphertext')->not->toContain('a_first');
});

it('never changes empty strings or whitespace inside envelopes, while still tidying the rest of the request', function () {
    $envelopes = envelopesFor($this->needed);
    $envelopes[0]['ciphertext'] = '  padded ciphertext  ';
    $envelopes[0]['header'] = ['blank' => '', 'spaced' => '  keep  '];

    $id = sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes, ['reply_to_id' => ''])->assertCreated()->json('data.id');

    $stored = MessageEnvelope::where('message_id', $id)->where('recipient_device_id', $envelopes[0]['recipient_device_id'])->firstOrFail();
    expect($stored->ciphertext)->toBe('  padded ciphertext  ')
        ->and($stored->header)->toBe(['blank' => '', 'spaced' => '  keep  '])
        ->and(Message::find($id)->reply_to_id)->toBeNull(); // the rest of the request is still normalised
});

it('answers 422 rather than 500 for a ciphertext containing a NUL byte', function () {
    $envelopes = envelopesFor($this->needed);
    $envelopes[0]['ciphertext'] = "abc\0def";

    sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertUnprocessable()->assertJsonValidationErrors('envelopes.0.ciphertext');
    expect(Message::count())->toBe(0);
});

it('accepts an envelope for the sending device itself, but does not require it', function () {
    $withSelf = [...envelopesFor($this->needed), ...envelopesFor([$this->alicePhone])];

    $id = sendEncrypted($this, $this->chat, $this->alicePhone, $withSelf)->assertCreated()->json('data.id');

    expect(MessageEnvelope::where('message_id', $id)->count())->toBe(4);
});

it('sends to a group, with every member\'s devices covered', function () {
    $group = makeEncryptedGroup($this->alice, [$this->bob, $this->carol]);
    $needed = [$this->aliceLaptop, $this->bobPhone, $this->bobLaptop, $this->carolPhone];

    $id = sendEncrypted($this, $group, $this->alicePhone, envelopesFor($needed))->assertCreated()->json('data.id');

    expect(MessageEnvelope::where('message_id', $id)->count())->toBe(4);
});

it('can reply to another message', function () {
    $first = sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))->json('data.id');

    sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), ['reply_to_id' => $first])
        ->assertCreated()->assertJsonPath('data.reply_to_id', $first);
});

it('updates the chat activity and the sender\'s read position', function () {
    $this->chat->update(['last_message_at' => now()->subDay()]);

    $id = sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))->json('data.id');

    expect($this->chat->fresh()->last_message_at->gt(now()->subMinute()))->toBeTrue()
        ->and($this->chat->membershipOf($this->alice)->fresh()->last_read_message_id)->toBe($id);
});

describe('the plaintext rule', function () {
    it('rejects content, however it is sent', function (mixed $content) {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), ['content' => $content])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('content');

        expect(Message::count())->toBe(0)->and(MessageEnvelope::count())->toBe(0);
    })->with(['hello', '0', 'Hello <b>world</b>']);

    it('accepts an explicitly empty content', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), ['content' => null])->assertCreated();
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), ['content' => ''])->assertCreated();
    });

    it('rejects content even when the envelopes are perfect', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), ['content' => 'leaked plaintext'])->assertUnprocessable();

        expect(Message::where('content', 'leaked plaintext')->exists())->toBeFalse();
    });

    it('never stores plaintext in the metadata either', function () {
        $id = sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), ['metadata' => ['note' => 'secret']])->assertCreated()->json('data.id');

        expect(Message::find($id)->metadata)->toBe(['sender_device_id' => $this->alicePhone->id]);
    });
});

describe('envelope coverage', function () {
    it('answers 409 with the missing devices when one is left out', function () {
        $envelopes = envelopesFor([$this->bobPhone, $this->aliceLaptop]); // bobLaptop missing

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)
            ->assertStatus(409)
            ->assertJsonPath('code', 'envelope_mismatch')
            ->assertJsonPath('missing_device_ids', [$this->bobLaptop->id])
            ->assertJsonPath('unexpected_device_ids', [])
            ->assertJsonStructure(['message']);
    });

    it('requires the sender\'s other devices too', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([$this->bobPhone, $this->bobLaptop]))
            ->assertStatus(409)
            ->assertJsonPath('missing_device_ids', [$this->aliceLaptop->id]);
    });

    it('lists every missing device', function () {
        $response = sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([$this->bobPhone]))->assertStatus(409);

        expect($response->json('missing_device_ids'))->toEqualCanonicalizing([$this->aliceLaptop->id, $this->bobLaptop->id]);
    });

    it('answers 409 for a device that should not get an envelope', function (string $case) {
        $stray = match ($case) {
            'revoked device' => makeDevice($this->bob, 0, ['revoked_at' => now()]),
            'device of a non-member' => $this->carolPhone,
            'unknown device' => (object) ['id' => (string) Str::uuid()],
        };
        $envelopes = [...envelopesFor($this->needed), ...envelopesFor([$stray])];

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)
            ->assertStatus(409)
            ->assertJsonPath('code', 'envelope_mismatch')
            ->assertJsonPath('missing_device_ids', [])
            ->assertJsonPath('unexpected_device_ids', [$stray->id]);
    })->with(['revoked device', 'device of a non-member', 'unknown device']);

    it('reports missing and unexpected devices together', function () {
        $envelopes = [...envelopesFor([$this->bobPhone, $this->aliceLaptop]), ...envelopesFor([$this->carolPhone])];

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)
            ->assertStatus(409)
            ->assertJsonPath('missing_device_ids', [$this->bobLaptop->id])
            ->assertJsonPath('unexpected_device_ids', [$this->carolPhone->id]);
    });

    it('wants a new device to be included from then on', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))->assertCreated();

        $newDevice = makeDevice($this->bob);

        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))
            ->assertStatus(409)->assertJsonPath('missing_device_ids', [$newDevice->id]);
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([...$this->needed, $newDevice]))->assertCreated();
    });

    it('stops wanting a device once it is revoked', function () {
        $this->bobLaptop->update(['revoked_at' => now()]);

        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([$this->aliceLaptop, $this->bobPhone]))->assertCreated();
    });

    it('does not ask for devices of people who left the chat', function () {
        $group = makeEncryptedGroup($this->alice, [$this->bob, $this->carol]);
        $group->chatMembers()->where('user_id', $this->carol->id)->delete();

        sendEncrypted($this, $group, $this->alicePhone, envelopesFor($this->needed))->assertCreated();
        sendEncrypted($this, $group, $this->alicePhone, envelopesFor([...$this->needed, $this->carolPhone]))
            ->assertStatus(409)->assertJsonPath('unexpected_device_ids', [$this->carolPhone->id]);
    });

    it('does not ask for devices of deleted users', function () {
        $this->bob->delete();

        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([$this->aliceLaptop]))->assertCreated();
    });

    it('says so plainly when nobody else can read the message', function () {
        $loner = User::factory()->create(); // no devices at all
        $chat = makeEncryptedDirect(User::factory()->create(), $loner);
        $alone = signIn(User::factory()->create());
        $device = makeDevice($alone);
        $chat = makeEncryptedDirect($alone, $loner);

        sendEncrypted($this, $chat, $device, [])->assertStatus(409)->assertJsonPath('code', 'no_recipient_devices');
    });

    it('treats an empty list as missing everything when others do have devices', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, [])
            ->assertStatus(409)
            ->assertJsonPath('code', 'envelope_mismatch');
    });

    it('creates nothing when it answers 409', function () {
        $before = $this->chat->fresh()->last_message_at;

        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([$this->bobPhone]))->assertStatus(409);

        expect(Message::count())->toBe(0)->and(MessageEnvelope::count())->toBe(0)
            ->and($this->chat->fresh()->last_message_at->eq($before))->toBeTrue();
    });

    it('is checked under a shared lock on the chat, so a member cannot be removed halfway through', function () {
        $queries = collect();
        DB::listen(fn ($q) => $queries->push($q->sql));

        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))->assertCreated();

        expect($queries->filter(fn ($sql) => str_contains($sql, 'for share') && str_contains($sql, '"chats"')))->not->toBeEmpty();
    });
});

describe('request validation', function () {
    it('requires an envelopes field', function () {
        $this->withHeader('X-Device-Id', $this->alicePhone->id)->postJson("/api/v1/chats/{$this->chat->id}/messages", [
            'client_id' => (string) Str::uuid(), 'type' => 'text',
        ])->assertUnprocessable()->assertJsonValidationErrors('envelopes');
    });

    it('validates each envelope', function (Closure $change, string $field) {
        $envelopes = $change(envelopesFor($this->needed));

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertUnprocessable()->assertJsonValidationErrors($field);
        expect(Message::count())->toBe(0);
    })->with([
        'no ciphertext' => [function (array $e) {
            unset($e[0]['ciphertext']);

            return $e;
        }, 'envelopes.0.ciphertext'],
        'ciphertext not a string' => [function (array $e) {
            $e[0]['ciphertext'] = ['x'];

            return $e;
        }, 'envelopes.0.ciphertext'],
        'ciphertext too long' => [function (array $e) {
            $e[0]['ciphertext'] = str_repeat('a', 32769);

            return $e;
        }, 'envelopes.0.ciphertext'],
        'no header' => [function (array $e) {
            unset($e[0]['header']);

            return $e;
        }, 'envelopes.0.header'],
        'empty header' => [function (array $e) {
            $e[0]['header'] = [];

            return $e;
        }, 'envelopes.0.header'],
        'header not an object' => [function (array $e) {
            $e[0]['header'] = 'text';

            return $e;
        }, 'envelopes.0.header'],
        'header too big' => [function (array $e) {
            $e[0]['header'] = ['blob' => str_repeat('a', 4100)];

            return $e;
        }, 'envelopes.0.header'],
        'no device id' => [function (array $e) {
            unset($e[1]['recipient_device_id']);

            return $e;
        }, 'envelopes.1.recipient_device_id'],
        'device id not a uuid' => [function (array $e) {
            $e[1]['recipient_device_id'] = 'nope';

            return $e;
        }, 'envelopes.1.recipient_device_id'],
        'same device twice' => [function (array $e) {
            $e[1]['recipient_device_id'] = $e[0]['recipient_device_id'];

            return $e;
        }, 'envelopes.1.recipient_device_id'],
    ]);

    it('accepts a ciphertext of exactly the maximum length', function () {
        $envelopes = envelopesFor($this->needed);
        $envelopes[0]['ciphertext'] = str_repeat('a', 32768);

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertCreated();
    });

    it('accepts a header of exactly the maximum size', function () {
        $envelopes = envelopesFor($this->needed);
        $filler = 4096 - strlen(json_encode(['k' => '']));
        $envelopes[0]['header'] = ['k' => str_repeat('a', $filler)];
        expect(strlen(json_encode($envelopes[0]['header'])))->toBe(4096);

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertCreated();
    });

    it('does not read the ciphertext: any text up to the size limit is stored', function () {
        $envelopes = envelopesFor($this->needed);
        $envelopes[0]['ciphertext'] = 'this is definitely not base64 !!! and not ciphertext either';

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertCreated();
    });

    it('rejects more than 1000 envelopes', function () {
        $envelopes = array_map(fn () => [
            'recipient_device_id' => (string) Str::uuid(), 'ciphertext' => 'x', 'header' => ['a' => 1],
        ], range(1, 1001));

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertUnprocessable()->assertJsonValidationErrors('envelopes');
    });

    it('requires the type and client_id like any message', function () {
        $this->withHeader('X-Device-Id', $this->alicePhone->id)
            ->postJson("/api/v1/chats/{$this->chat->id}/messages", ['envelopes' => envelopesFor($this->needed)])
            ->assertUnprocessable()->assertJsonValidationErrors(['client_id', 'type']);
    });

    it('does not let clients send system messages', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), ['type' => 'system'])
            ->assertUnprocessable()->assertJsonValidationErrors('type');
    });
});

describe('which device is sending', function () {
    it('needs the X-Device-Id header', function () {
        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", [
            'client_id' => (string) Str::uuid(), 'type' => 'text', 'envelopes' => envelopesFor($this->needed),
        ])->assertUnprocessable()->assertJsonValidationErrors('X-Device-Id');

        expect(Message::count())->toBe(0);
    });

    it('refuses another user\'s device', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), deviceHeader: $this->bobPhone->id)->assertForbidden();

        expect(Message::count())->toBe(0);
    });

    it('refuses a revoked device of the sender', function () {
        $old = makeDevice($this->alice, 0, ['revoked_at' => now()]);

        sendEncrypted($this, $this->chat, $old, envelopesFor($this->needed))->assertForbidden();
    });

    it('refuses a header that is not a device id', function (string $header) {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), deviceHeader: $header)->assertForbidden();
    })->with(['garbage', '123', "1' or '1'='1"]);

    it('refuses an unknown device id', function () {
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed), deviceHeader: (string) Str::uuid())->assertForbidden();
    });

    it('records the device on the message so recipients know which session to use', function () {
        $id = sendEncrypted($this, $this->chat, $this->aliceLaptop, envelopesFor([$this->alicePhone, $this->bobPhone, $this->bobLaptop]))->assertCreated()->json('data.id');

        expect(Message::find($id)->metadata['sender_device_id'])->toBe($this->aliceLaptop->id);
    });

    it('records that the device was used, at most once every five minutes', function () {
        $this->alicePhone->update(['last_active_at' => null]);

        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))->assertCreated();
        $first = $this->alicePhone->fresh()->last_active_at;
        expect($first)->not->toBeNull();

        $this->travel(2)->minutes();
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))->assertCreated();
        expect($this->alicePhone->fresh()->last_active_at->eq($first))->toBeTrue();

        $this->travel(4)->minutes();
        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor($this->needed))->assertCreated();
        expect($this->alicePhone->fresh()->last_active_at->gt($first))->toBeTrue();
    });
});

describe('retries', function () {
    it('returns the original message, without storing envelopes again', function () {
        $clientId = (string) Str::uuid();
        $envelopes = envelopesFor($this->needed);

        $first = sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes, ['client_id' => $clientId])->assertCreated();
        $retry = sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes, ['client_id' => $clientId])->assertOk();

        expect($retry->json('data.id'))->toBe($first->json('data.id'))
            ->and(Message::count())->toBe(1)->and(MessageEnvelope::count())->toBe(3);
    });

    it('still returns the original when the devices have changed since', function () {
        $clientId = (string) Str::uuid();
        $envelopes = envelopesFor($this->needed);
        $first = sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes, ['client_id' => $clientId])->assertCreated();

        makeDevice($this->bob); // now the old envelope list no longer covers everyone

        sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes, ['client_id' => $clientId])
            ->assertOk()->assertJsonPath('data.id', $first->json('data.id'));
    });
});

describe('real-time', function () {
    it('broadcasts the message without its content or any ciphertext', function () {
        fakeBroadcasts();
        $envelopes = envelopesFor($this->needed);

        $id = sendEncrypted($this, $this->chat, $this->alicePhone, $envelopes)->assertCreated()->json('data.id');

        Event::assertDispatched(MessageSent::class, function (MessageSent $event) use ($id, $envelopes) {
            $message = payloadOf($event)['message'];
            expect($message['id'])->toBe($id)
                ->and($message['content'])->toBeNull()
                ->and($message['encrypted'])->toBeTrue()
                ->and($message['metadata']['sender_device_id'])->toBe($this->alicePhone->id)
                ->and($message)->not->toHaveKey('envelope');

            $json = json_encode($event->broadcastWith());
            foreach ($envelopes as $envelope) {
                expect($json)->not->toContain($envelope['ciphertext'])->not->toContain($envelope['header']['nonce']);
            }

            return true;
        });
    });

    it('is not broadcast when the envelopes are rejected', function () {
        fakeBroadcasts();

        sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([$this->bobPhone]))->assertStatus(409);

        Event::assertNotDispatched(MessageSent::class);
    });
});

describe('plaintext chats are unaffected', function () {
    it('refuse envelopes', function () {
        $plain = makeDirect($this->alice, $this->bob);

        $this->postJson("/api/v1/chats/{$plain->id}/messages", [
            'client_id' => (string) Str::uuid(), 'type' => 'text', 'content' => 'hi', 'envelopes' => envelopesFor($this->needed),
        ])->assertUnprocessable()->assertJsonValidationErrors('envelopes');
    });

    it('need no device header and show the content', function () {
        $plain = makeDirect($this->alice, $this->bob);

        $this->postJson("/api/v1/chats/{$plain->id}/messages", ['client_id' => (string) Str::uuid(), 'type' => 'text', 'content' => 'hello'])
            ->assertCreated()
            ->assertJsonPath('data.content', 'hello')
            ->assertJsonPath('data.encrypted', false)
            ->assertJsonMissingPath('data.envelope');

        expect(Chat::find($plain->id)->is_encrypted)->toBeFalse();
    });
});

it('is members only', function () {
    signIn($this->carol);

    sendEncrypted($this, $this->chat, $this->carolPhone, envelopesFor($this->needed))->assertForbidden();
});
