<?php

use App\Jobs\GenerateAttachmentThumbnail;
use App\Models\Attachment;
use App\Models\Message;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;

beforeEach(function () {
    Storage::fake('local');
    Storage::fake('public');
    $this->me = signIn();
    $this->friend = User::factory()->create();
    $this->chat = makeDirect($this->me, $this->friend);
});

function upload($test, $chat, UploadedFile $file)
{
    return $test->post("/api/v1/chats/{$chat->id}/attachments", ['file' => $file], ['Accept' => 'application/json']);
}

describe('uploading', function () {
    it('stores the file privately and returns its details', function () {
        Queue::fake();

        $response = upload($this, $this->chat, UploadedFile::fake()->create('Report 2026.pdf', 120, 'application/pdf'))
            ->assertCreated()
            ->assertJsonPath('data.original_name', 'Report 2026.pdf')
            ->assertJsonPath('data.mime_type', 'application/pdf')
            ->assertJsonPath('data.size', 120 * 1024)
            ->assertJsonPath('data.thumbnail_url', null)
            ->assertJsonMissingPath('data.path')
            ->assertJsonMissingPath('data.encrypted_key');

        $attachment = Attachment::findOrFail($response->json('data.id'));
        expect($attachment)
            ->chat_id->toBe($this->chat->id)
            ->uploader_id->toBe($this->me->id)
            ->message_id->toBeNull()
            ->disk->toBe('local');

        Storage::disk('local')->assertExists($attachment->path);
        expect(Storage::disk('public')->allFiles())->toBe([]);
    });

    it('never uses the client\'s file name on disk', function () {
        Queue::fake();

        $response = upload($this, $this->chat, UploadedFile::fake()->create('../../evil.php', 5, 'application/pdf'))->assertCreated();

        $path = Attachment::find($response->json('data.id'))->path;
        expect($path)->toStartWith("chat-attachments/{$this->chat->id}/")
            ->and($path)->not->toContain('evil')->not->toContain('..')
            ->and($path)->toEndWith('.pdf');
    });

    it('accepts a file of exactly 25 MB and rejects anything larger', function () {
        Queue::fake();

        upload($this, $this->chat, UploadedFile::fake()->create('ok.bin', 25 * 1024))->assertCreated();
        upload($this, $this->chat, UploadedFile::fake()->create('big.bin', 25 * 1024 + 1))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('file');
    });

    it('requires a file', function () {
        $this->postJson("/api/v1/chats/{$this->chat->id}/attachments", [])->assertUnprocessable()->assertJsonValidationErrors('file');
    });

    it('queues a thumbnail job for images only', function () {
        Queue::fake();

        upload($this, $this->chat, UploadedFile::fake()->image('photo.jpg', 800, 600))->assertCreated();
        Queue::assertPushed(GenerateAttachmentThumbnail::class, 1);

        upload($this, $this->chat, UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf'))->assertCreated();
        Queue::assertPushed(GenerateAttachmentThumbnail::class, 1);
    });

    it('generates a thumbnail that fits 400px and keeps the aspect ratio', function () {
        // The test queue runs jobs synchronously.
        $id = upload($this, $this->chat, UploadedFile::fake()->image('photo.png', 1200, 800))->json('data.id');

        $attachment = Attachment::find($id);
        expect($attachment->thumbnail_path)->not->toBeNull();

        [$w, $h] = getimagesizefromstring(Storage::disk('local')->get($attachment->thumbnail_path));
        expect([$w, $h])->toBe([400, 267]);
    });

    it('does not enlarge small images', function () {
        $id = upload($this, $this->chat, UploadedFile::fake()->image('tiny.png', 100, 50))->json('data.id');

        [$w, $h] = getimagesizefromstring(Storage::disk('local')->get(Attachment::find($id)->thumbnail_path));
        expect([$w, $h])->toBe([100, 50]);
    });

    it('has no thumbnail URL in the upload response, but messages show it once the job has run', function () {
        $upload = upload($this, $this->chat, UploadedFile::fake()->image('photo.png', 600, 600))->assertCreated();

        // The job runs after the response data was built (always, on a real queue).
        expect($upload->json('data.thumbnail_url'))->toBeNull();

        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", [
            'client_id' => (string) Str::uuid(),
            'type' => 'image',
            'metadata' => ['attachment_id' => $upload->json('data.id')],
        ])->assertCreated()->assertJsonPath('data.attachment.thumbnail_url', fn ($url) => str_contains($url, '/thumbnail?'));
    });
});

describe('sending an attachment as a message', function () {
    function sendWithAttachment($test, $chat, Attachment|string $attachment, string $type = 'file', array $extra = [])
    {
        return $test->postJson("/api/v1/chats/{$chat->id}/messages", array_merge([
            'client_id' => (string) Str::uuid(),
            'type' => $type,
            'content' => 'see attached',
            'metadata' => ['attachment_id' => $attachment instanceof Attachment ? $attachment->id : $attachment],
        ], $extra));
    }

    it('links the attachment to the new message', function () {
        Queue::fake();
        $attachment = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'))->json('data.id'));

        $response = sendWithAttachment($this, $this->chat, $attachment)
            ->assertCreated()
            ->assertJsonPath('data.attachment.id', $attachment->id)
            ->assertJsonPath('data.attachment.original_name', 'a.pdf')
            ->assertJsonPath('data.metadata.attachment_id', $attachment->id);

        expect($attachment->fresh()->message_id)->toBe($response->json('data.id'));
    });

    it('shows the attachment when listing messages and in the chat list', function () {
        Queue::fake();
        $attachment = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->image('p.png', 50, 50))->json('data.id'));
        sendWithAttachment($this, $this->chat, $attachment, 'image')->assertCreated();

        $this->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertJsonPath('data.0.attachment.id', $attachment->id);
        $this->getJson('/api/v1/chats')->assertJsonPath('data.0.latest_message.attachment.id', $attachment->id);
    });

    it('returns the same message on a retry even though the attachment is now used', function () {
        Queue::fake();
        $attachment = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'))->json('data.id'));
        $clientId = (string) Str::uuid();

        $first = sendWithAttachment($this, $this->chat, $attachment, 'file', ['client_id' => $clientId])->assertCreated();
        $retry = sendWithAttachment($this, $this->chat, $attachment, 'file', ['client_id' => $clientId])->assertOk();

        expect($retry->json('data.id'))->toBe($first->json('data.id'))->and(Message::count())->toBe(1);
    });

    it('cannot be used by two messages', function () {
        Queue::fake();
        $attachment = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->create('a.pdf', 10, 'application/pdf'))->json('data.id'));

        sendWithAttachment($this, $this->chat, $attachment)->assertCreated();
        sendWithAttachment($this, $this->chat, $attachment)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('metadata.attachment_id');

        expect(Message::count())->toBe(1);
    });

    it('rejects attachments that are unknown, from another chat, or uploaded by someone else', function (string $case) {
        Queue::fake();
        $attachmentId = match ($case) {
            'unknown' => (string) Str::uuid(),
            'other chat' => Attachment::factory()->create(['chat_id' => makeDirect($this->me, User::factory()->create())->id, 'uploader_id' => $this->me->id])->id,
            'other uploader' => Attachment::factory()->create(['chat_id' => $this->chat->id, 'uploader_id' => $this->friend->id])->id,
        };

        sendWithAttachment($this, $this->chat, $attachmentId)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('metadata.attachment_id');

        expect(Message::count())->toBe(0);
    })->with(['unknown', 'other chat', 'other uploader']);

    it('checks the attachment type against the message type', function (string $messageType, string $mime) {
        $attachment = Attachment::factory()->create(['chat_id' => $this->chat->id, 'uploader_id' => $this->me->id, 'mime_type' => $mime]);

        sendWithAttachment($this, $this->chat, $attachment, $messageType)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('metadata.attachment_id');

        expect($attachment->fresh()->message_id)->toBeNull();
    })->with([
        'image message with a pdf' => ['image', 'application/pdf'],
        'voice message with an image' => ['voice', 'image/png'],
    ]);

    it('accepts a voice note', function () {
        $attachment = Attachment::factory()->create(['chat_id' => $this->chat->id, 'uploader_id' => $this->me->id, 'mime_type' => 'audio/webm']);

        sendWithAttachment($this, $this->chat, $attachment, 'voice')->assertCreated()->assertJsonPath('data.type', 'voice');
    });

    it('rolls the message back if the attachment is rejected', function () {
        $attachment = Attachment::factory()->create(['chat_id' => $this->chat->id, 'uploader_id' => $this->friend->id]);
        $before = $this->chat->fresh()->last_message_at;

        sendWithAttachment($this, $this->chat, $attachment)->assertUnprocessable();

        expect(Message::count())->toBe(0)->and($this->chat->fresh()->last_message_at->eq($before))->toBeTrue();
    });

    it('leaves a plain text message with no attachment', function () {
        $this->postJson("/api/v1/chats/{$this->chat->id}/messages", [
            'client_id' => (string) Str::uuid(),
            'type' => 'text',
            'content' => 'hi',
            'metadata' => ['attachment_id' => (string) Str::uuid()],
        ])->assertCreated()->assertJsonPath('data.attachment', null);
    });
});

describe('downloading', function () {
    it('serves the file through the signed URL without a bearer token', function () {
        Queue::fake();
        $content = 'pdf-bytes';
        $id = upload($this, $this->chat, UploadedFile::fake()->createWithContent('a.pdf', $content))->json('data.id');
        $url = Attachment::find($id)->fileUrl();

        // A fresh request with no authentication at all.
        $this->app['auth']->forgetGuards();
        $response = $this->get($url);

        $response->assertOk()
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertHeader('Content-Security-Policy', "default-src 'none'; sandbox");
        expect($response->streamedContent())->toBe($content);
    });

    it('forces non-image files to download and shows images inline', function () {
        Queue::fake();
        $pdf = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->create('a.pdf', 5, 'application/pdf'))->json('data.id'));
        $png = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->image('a.png', 10, 10))->json('data.id'));
        $html = Attachment::factory()->create(['chat_id' => $this->chat->id, 'mime_type' => 'text/html', 'path' => 'chat-attachments/x/page.html']);
        Storage::disk('local')->put($html->path, '<script>alert(1)</script>');

        expect($this->get($pdf->fileUrl())->headers->get('Content-Disposition'))->toStartWith('attachment')
            ->and($this->get($png->fileUrl())->headers->get('Content-Disposition'))->toStartWith('inline')
            ->and($this->get($html->fileUrl())->headers->get('Content-Disposition'))->toStartWith('attachment');
    });

    it('serves the thumbnail', function () {
        $attachment = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->image('a.png', 800, 800))->json('data.id'));

        $this->get($attachment->thumbnailUrl())->assertOk()->assertHeader('Content-Type', 'image/webp');
    });

    it('answers 404 for a thumbnail that does not exist', function () {
        Queue::fake();
        $attachment = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->create('a.pdf', 5, 'application/pdf'))->json('data.id'));

        $this->get(URL::temporarySignedRoute('attachments.thumbnail', now()->addMinute(), $attachment))->assertNotFound();
    });

    it('refuses unsigned, tampered and expired URLs', function () {
        Queue::fake();
        $attachment = Attachment::find(upload($this, $this->chat, UploadedFile::fake()->create('a.pdf', 5, 'application/pdf'))->json('data.id'));
        $other = Attachment::factory()->create(['chat_id' => $this->chat->id]);

        $this->get("/api/v1/attachments/{$attachment->id}/file")->assertForbidden();

        // Re-using one attachment's signature on another attachment's id.
        $signed = $attachment->fileUrl();
        $this->get(str_replace($attachment->id, $other->id, $signed))->assertForbidden();

        $this->travel(config('chat.attachments.url_ttl_minutes') + 1)->minutes();
        $this->get($signed)->assertForbidden();
    });

    it('answers 404 when the file has gone from disk', function () {
        $attachment = Attachment::factory()->create(['chat_id' => $this->chat->id]);

        $this->get($attachment->fileUrl())->assertNotFound();
    });
});
