<?php

use App\Jobs\GenerateAttachmentThumbnail;
use App\Models\Attachment;
use App\Models\Message;
use App\Models\MessageEnvelope;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    $this->alice = signIn();
    $this->bob = User::factory()->create();
    $this->alicePhone = makeDevice($this->alice);
    $this->bobPhone = makeDevice($this->bob);
    $this->chat = makeEncryptedDirect($this->alice, $this->bob);
    $this->send = fn (array $overrides = []) => sendEncrypted($this, $this->chat, $this->alicePhone, envelopesFor([$this->bobPhone]), $overrides);
});

describe('editing', function () {
    it('is not possible: the server cannot re-encrypt for every device', function () {
        $id = ($this->send)()->assertCreated()->json('data.id');

        $this->patchJson("/api/v1/messages/{$id}", ['content' => 'edited plaintext'])->assertForbidden();

        expect(Message::find($id)->content)->toBeNull()->and(Message::find($id)->is_edited)->toBeFalse();
    });

    it('still works in plaintext chats', function () {
        $plain = makeDirect($this->alice, $this->bob);
        $message = addMessage($plain, $this->alice, ['content' => 'old']);

        $this->patchJson("/api/v1/messages/{$message->id}", ['content' => 'new'])->assertOk()->assertJsonPath('data.content', 'new');
    });
});

describe('deleting', function () {
    it('removes the message and its envelopes straight away', function () {
        $id = ($this->send)()->assertCreated()->json('data.id');
        expect(MessageEnvelope::where('message_id', $id)->count())->toBe(1);

        $this->deleteJson("/api/v1/messages/{$id}")->assertNoContent();

        expect(Message::find($id))->toBeNull()
            ->and(Message::withTrashed()->find($id))->not->toBeNull()
            ->and(MessageEnvelope::where('message_id', $id)->count())->toBe(0);
    });

    it('lets a group admin delete a member\'s encrypted message', function () {
        $group = makeEncryptedGroup($this->alice, [$this->bob]);
        $message = addMessage($group, $this->bob, ['content' => null, 'metadata' => ['sender_device_id' => $this->bobPhone->id]]);
        MessageEnvelope::create(['message_id' => $message->id, 'recipient_device_id' => $this->alicePhone->id, 'ciphertext' => 'c', 'header' => ['a' => 1]]);

        $this->deleteJson("/api/v1/messages/{$message->id}")->assertNoContent();

        expect(MessageEnvelope::where('message_id', $message->id)->count())->toBe(0);
    });

    it('keeps another message\'s envelopes', function () {
        $keep = ($this->send)()->json('data.id');
        $drop = ($this->send)()->json('data.id');

        $this->deleteJson("/api/v1/messages/{$drop}")->assertNoContent();

        expect(MessageEnvelope::where('message_id', $keep)->count())->toBe(1);
    });

    it('is refused for someone who may not delete it, leaving the envelopes alone', function () {
        $id = ($this->send)()->json('data.id');
        signIn($this->bob);

        $this->deleteJson("/api/v1/messages/{$id}")->assertForbidden();

        expect(MessageEnvelope::where('message_id', $id)->count())->toBe(1);
    });
});

describe('attachments', function () {
    beforeEach(function () {
        Storage::fake('local');
    });

    function uploadBlob($test, $chat, array $extra = [], ?UploadedFile $file = null)
    {
        return $test->post("/api/v1/chats/{$chat->id}/attachments", array_merge(
            ['file' => $file ?? UploadedFile::fake()->createWithContent('holiday-photo.jpg', random_bytes(2000))],
            $extra,
        ), ['Accept' => 'application/json']);
    }

    it('are stored as opaque blobs: no name, no type, no thumbnail', function () {
        Queue::fake();

        $response = uploadBlob($this, $this->chat, [], UploadedFile::fake()->image('holiday-photo.png', 400, 300))
            ->assertCreated()
            ->assertJsonPath('data.original_name', 'attachment')
            ->assertJsonPath('data.mime_type', 'application/octet-stream')
            ->assertJsonPath('data.thumbnail_url', null);

        $attachment = Attachment::findOrFail($response->json('data.id'));
        expect($attachment->path)->toEndWith('.bin')->and($attachment->path)->not->toContain('holiday')
            ->and($attachment->thumbnail_path)->toBeNull();
        Queue::assertNotPushed(GenerateAttachmentThumbnail::class);
        Storage::disk('local')->assertExists($attachment->path);
    });

    it('keep an opaque key from the client untouched', function () {
        $response = uploadBlob($this, $this->chat, ['encrypted_key' => '  wrapped-file-key==  '])->assertCreated();

        expect($response->json('data.encrypted_key'))->toBe('wrapped-file-key==')
            ->and(Attachment::find($response->json('data.id'))->encrypted_key)->toBe('wrapped-file-key==');
    });

    it('show no encrypted_key when there is none', function () {
        uploadBlob($this, $this->chat)->assertCreated()->assertJsonMissingPath('data.encrypted_key');
    });

    it('limit the key size', function () {
        uploadBlob($this, $this->chat, ['encrypted_key' => str_repeat('a', 4097)])->assertUnprocessable()->assertJsonValidationErrors('encrypted_key');
    });

    it('do not take an encrypted_key in a plaintext chat', function () {
        $plain = makeDirect($this->alice, $this->bob);

        uploadBlob($this, $plain, ['encrypted_key' => 'x'])->assertUnprocessable()->assertJsonValidationErrors('encrypted_key');
    });

    it('can be attached to an encrypted message of any kind, without a type check', function (string $type) {
        $attachmentId = uploadBlob($this, $this->chat)->assertCreated()->json('data.id');

        $response = ($this->send)(['type' => $type, 'metadata' => ['attachment_id' => $attachmentId]])
            ->assertCreated()
            ->assertJsonPath('data.type', $type)
            ->assertJsonPath('data.content', null)
            ->assertJsonPath('data.attachment.id', $attachmentId);

        expect(Attachment::find($attachmentId)->message_id)->toBe($response->json('data.id'))
            ->and(Message::find($response->json('data.id'))->metadata)->toEqualCanonicalizing(['sender_device_id' => $this->alicePhone->id, 'attachment_id' => $attachmentId]);
    })->with(['image', 'voice', 'file']);

    it('are downloaded as files, never displayed in the browser', function () {
        $id = uploadBlob($this, $this->chat)->assertCreated()->json('data.id');
        $url = Attachment::find($id)->fileUrl();

        $this->get($url)->assertOk()->assertHeader('Content-Type', 'application/octet-stream');
        expect($this->get($url)->headers->get('Content-Disposition'))->toStartWith('attachment');
    });

    it('still need a real attachment id', function () {
        ($this->send)(['type' => 'file', 'metadata' => ['attachment_id' => (string) Str::uuid()]])
            ->assertUnprocessable()->assertJsonValidationErrors('metadata.attachment_id');
    });
});
