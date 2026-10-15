<?php

use App\Models\Attachment;
use App\Models\Message;
use App\Models\MessageEnvelope;
use App\Models\User;
use App\Services\AttachmentStorage;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

beforeEach(function () {
    Storage::fake('local');
    Storage::fake('public');
    $this->alice = User::factory()->create();
    $this->bob = User::factory()->create();
    $this->chat = makeDirect($this->alice, $this->bob);
});

/** A message that was deleted $daysAgo days ago (a soft delete: the row is still there). */
function deletedMessage($chat, $sender, float $daysAgo, array $attributes = []): Message
{
    $message = addMessage($chat, $sender, $attributes);
    DB::table('messages')->where('id', $message->id)->update(['deleted_at' => now()->subSeconds((int) ($daysAgo * 86400))]);

    return $message;
}

/** An attachment of a message, with its file (and thumbnail) really on the fake disk. */
function attachmentOf($chat, Message $message, string $disk = 'local', bool $thumbnail = true): Attachment
{
    $path = "chat-attachments/{$chat->id}/".Str::uuid().'.bin';
    $thumb = $thumbnail ? str_replace('.bin', '_thumb.webp', $path) : null;
    Storage::disk($disk)->put($path, 'file bytes');
    $thumb && Storage::disk($disk)->put($thumb, 'thumb bytes');

    return Attachment::factory()->create([
        'chat_id' => $chat->id, 'uploader_id' => $message->sender_id, 'message_id' => $message->id,
        'disk' => $disk, 'path' => $path, 'thumbnail_path' => $thumb,
    ]);
}

/** Store an encrypted copy of a message for a device, as the send flow does. */
function envelopeFor(Message $message, $device): void
{
    foreach (envelopesFor([$device]) as $envelope) {
        MessageEnvelope::create([
            'message_id' => $message->id,
            'recipient_device_id' => $envelope['recipient_device_id'],
            'ciphertext' => $envelope['ciphertext'],
            'header' => $envelope['header'],
        ]);
    }
}

describe('which messages are purged', function () {
    it('removes messages deleted more than 30 days ago and keeps everything else', function () {
        $old = deletedMessage($this->chat, $this->alice, 31);
        $recent = deletedMessage($this->chat, $this->alice, 29);
        $live = addMessage($this->chat, $this->alice);
        $liveButOld = addMessage($this->chat, $this->alice, ['created_at' => now()->subYear()]);

        $this->artisan('messages:purge-deleted')->expectsOutput('Purged 1 message(s) and 0 attachment(s).')->assertSuccessful();

        expect(Message::withTrashed()->pluck('id')->all())->toEqualCanonicalizing([$recent->id, $live->id, $liveButOld->id]);
    });

    it('draws the line at exactly 30 days', function () {
        $justOver = deletedMessage($this->chat, $this->alice, 0);
        DB::table('messages')->where('id', $justOver->id)->update(['deleted_at' => now()->subDays(30)->subSeconds(2)]);
        $justUnder = deletedMessage($this->chat, $this->alice, 0);
        DB::table('messages')->where('id', $justUnder->id)->update(['deleted_at' => now()->subDays(30)->addSeconds(30)]);

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        expect(Message::withTrashed()->pluck('id')->all())->toBe([$justUnder->id]);
    });

    it('follows the configured number of days', function () {
        config(['cleanup.deleted_messages_days' => 7]);
        deletedMessage($this->chat, $this->alice, 8);
        $kept = deletedMessage($this->chat, $this->alice, 6);

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        expect(Message::withTrashed()->pluck('id')->all())->toBe([$kept->id]);
    });

    it('also purges system messages and messages in encrypted chats', function () {
        $encrypted = makeEncryptedDirect($this->alice, $carol = User::factory()->create());
        deletedMessage($encrypted, $this->alice, 40);
        deletedMessage($this->chat, null, 40, ['type' => 'system', 'client_id' => null]);

        $this->artisan('messages:purge-deleted')->expectsOutput('Purged 2 message(s) and 0 attachment(s).')->assertSuccessful();

        expect(Message::withTrashed()->count())->toBe(0);
    });

    it('does nothing, harmlessly, when there is nothing to purge', function () {
        addMessage($this->chat, $this->alice);

        $this->artisan('messages:purge-deleted')->expectsOutput('Purged 0 message(s) and 0 attachment(s).')->assertSuccessful();
        $this->artisan('messages:purge-deleted')->assertSuccessful();

        expect(Message::count())->toBe(1);
    });

    it('can be run again after a purge without touching anything else', function () {
        deletedMessage($this->chat, $this->alice, 40);
        $kept = addMessage($this->chat, $this->alice);

        $this->artisan('messages:purge-deleted')->assertSuccessful();
        $this->artisan('messages:purge-deleted')->expectsOutput('Purged 0 message(s) and 0 attachment(s).')->assertSuccessful();

        expect(Message::pluck('id')->all())->toBe([$kept->id]);
    });
});

describe('what goes with a message', function () {
    it('deletes the attachment rows, files and thumbnails', function () {
        $message = deletedMessage($this->chat, $this->alice, 31);
        $attachment = attachmentOf($this->chat, $message);

        $this->artisan('messages:purge-deleted')->expectsOutput('Purged 1 message(s) and 1 attachment(s).')->assertSuccessful();

        Storage::disk('local')->assertMissing($attachment->path);
        Storage::disk('local')->assertMissing($attachment->thumbnail_path);
        expect(Attachment::count())->toBe(0)->and(Storage::disk('local')->allFiles())->toBe([]);
    });

    it('uses the disk each attachment was stored on', function () {
        $message = deletedMessage($this->chat, $this->alice, 31);
        $onLocal = attachmentOf($this->chat, $message, 'local', thumbnail: false);
        $other = deletedMessage($this->chat, $this->alice, 31);
        $onPublic = attachmentOf($this->chat, $other, 'public', thumbnail: false);

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        Storage::disk('local')->assertMissing($onLocal->path);
        Storage::disk('public')->assertMissing($onPublic->path);
    });

    it('leaves the attachments of messages that are kept alone', function () {
        $keptDeleted = deletedMessage($this->chat, $this->alice, 5);
        $keptLive = addMessage($this->chat, $this->alice);
        $a = attachmentOf($this->chat, $keptDeleted);
        $b = attachmentOf($this->chat, $keptLive);
        deletedMessage($this->chat, $this->alice, 40);

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        Storage::disk('local')->assertExists([$a->path, $a->thumbnail_path, $b->path, $b->thumbnail_path]);
        expect(Attachment::count())->toBe(2);
    });

    it('leaves uploads that were never attached to a message alone (another job handles those)', function () {
        deletedMessage($this->chat, $this->alice, 40);
        $pending = Attachment::factory()->create(['chat_id' => $this->chat->id, 'uploader_id' => $this->alice->id, 'path' => 'pending.bin']);
        Storage::disk('local')->put('pending.bin', 'x');

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        expect(Attachment::find($pending->id))->not->toBeNull();
        Storage::disk('local')->assertExists('pending.bin');
    });

    it('deletes the encrypted envelopes', function () {
        $encrypted = makeEncryptedDirect($this->alice, $carol = User::factory()->create());
        $message = deletedMessage($encrypted, $this->alice, 40);
        $device = makeDevice($carol);
        envelopeFor($message, $device);
        $kept = addMessage($encrypted, $this->alice);
        envelopeFor($kept, $device);

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        expect(MessageEnvelope::pluck('message_id')->all())->toBe([$kept->id]);
    });

    it('lets replies to a purged message survive, without the quoted original', function () {
        $original = deletedMessage($this->chat, $this->alice, 40);
        $reply = addMessage($this->chat, $this->bob, ['reply_to_id' => $original->id]);

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        expect($reply->fresh()->reply_to_id)->toBeNull();
        signIn($this->alice);
        $this->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertOk()->assertJsonPath('data.0.reply_to', null);
    });
});

describe('in batches, and safely', function () {
    it('handles more messages than fit in one batch', function () {
        config(['cleanup.chunk_size' => 2]);
        foreach (range(1, 7) as $_) {
            attachmentOf($this->chat, deletedMessage($this->chat, $this->alice, 40));
        }
        $kept = addMessage($this->chat, $this->alice);

        $this->artisan('messages:purge-deleted')->expectsOutput('Purged 7 message(s) and 7 attachment(s).')->assertSuccessful();

        expect(Message::withTrashed()->pluck('id')->all())->toBe([$kept->id])
            ->and(Storage::disk('local')->allFiles())->toBe([]);
    });

    it('purges nothing from a batch whose files cannot be deleted, and succeeds on the next run', function () {
        $message = deletedMessage($this->chat, $this->alice, 40);
        $attachment = attachmentOf($this->chat, $message);
        app()->instance(AttachmentStorage::class, new class extends AttachmentStorage
        {
            public function deleteFiles(Collection $attachments): void
            {
                throw new RuntimeException('disk unavailable');
            }
        });

        expect(fn () => Artisan::call('messages:purge-deleted'))->toThrow(RuntimeException::class, 'disk unavailable');

        // Nothing was half done: the message, its row and its file are all still there.
        expect(Message::withTrashed()->count())->toBe(1)->and(Attachment::count())->toBe(1);
        Storage::disk('local')->assertExists($attachment->path);

        app()->forgetInstance(AttachmentStorage::class);
        $this->artisan('messages:purge-deleted')->expectsOutput('Purged 1 message(s) and 1 attachment(s).')->assertSuccessful();
        Storage::disk('local')->assertMissing($attachment->path);
    });

    it('does not mind an attachment whose file is already gone', function () {
        $message = deletedMessage($this->chat, $this->alice, 40);
        $attachment = attachmentOf($this->chat, $message);
        Storage::disk('local')->delete([$attachment->path, $attachment->thumbnail_path]);

        $this->artisan('messages:purge-deleted')->assertSuccessful();

        expect(Message::withTrashed()->count())->toBe(0)->and(Attachment::count())->toBe(0);
    });

    it('asks the database a bounded number of questions per batch', function () {
        config(['cleanup.chunk_size' => 50]);
        foreach (range(1, 40) as $_) {
            attachmentOf($this->chat, deletedMessage($this->chat, $this->alice, 40));
        }

        $queries = countQueries(fn () => Artisan::call('messages:purge-deleted'));

        expect($queries)->toBeLessThan(15);
    });
});
