<?php

use App\Models\Attachment;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

beforeEach(function () {
    Storage::fake('local');
    Storage::fake('public');
    $this->alice = User::factory()->create();
    $this->chat = makeDirect($this->alice, User::factory()->create());
});

/** An upload that has (or has not) been attached to a message, created $hoursAgo hours ago, with its files on disk. */
function orphanUpload(array $attributes = [], float $hoursAgo = 0, bool $attached = false)
{
    $chat = test()->chat;
    $path = "chat-attachments/{$chat->id}/".Str::uuid().'.bin';
    Storage::disk($attributes['disk'] ?? 'local')->put($path, 'bytes');
    Storage::disk($attributes['disk'] ?? 'local')->put($thumb = str_replace('.bin', '_t.webp', $path), 'thumb');

    $attachment = Attachment::factory()->create(array_merge([
        'chat_id' => $chat->id, 'uploader_id' => test()->alice->id, 'path' => $path, 'thumbnail_path' => $thumb,
        'message_id' => $attached ? addMessage($chat, test()->alice)->id : null,
    ], $attributes));
    DB::table('attachments')->where('id', $attachment->id)->update(['created_at' => now()->subSeconds((int) ($hoursAgo * 3600))]);

    return $attachment;
}

it('deletes uploads that were never sent and are older than 24 hours, with their files and thumbnails', function () {
    $stale = orphanUpload(hoursAgo: 25);

    $this->artisan('attachments:purge-orphans')->expectsOutput('Deleted 1 orphaned attachment(s).')->assertSuccessful();

    expect(Attachment::count())->toBe(0)->and(Storage::disk('local')->allFiles())->toBe([]);
});

it('keeps recent uploads, which the person may still be about to send', function () {
    $recent = orphanUpload(hoursAgo: 23);

    $this->artisan('attachments:purge-orphans')->assertSuccessful();

    expect(Attachment::find($recent->id))->not->toBeNull();
    Storage::disk('local')->assertExists([$recent->path, $recent->thumbnail_path]);
});

it('never touches an attachment that belongs to a message, however old', function () {
    $sent = orphanUpload(hoursAgo: 24 * 400, attached: true);

    $this->artisan('attachments:purge-orphans')->assertSuccessful();

    expect(Attachment::find($sent->id))->not->toBeNull();
    Storage::disk('local')->assertExists($sent->path);
});

it('draws the line at the configured number of hours', function () {
    config(['cleanup.orphan_attachment_hours' => 2]);
    $old = orphanUpload(hoursAgo: 3);
    $new = orphanUpload(hoursAgo: 1);

    $this->artisan('attachments:purge-orphans')->assertSuccessful();

    expect(Attachment::pluck('id')->all())->toBe([$new->id]);
});

it('uses the disk each upload is on', function () {
    $a = orphanUpload(['disk' => 'local'], hoursAgo: 30);
    $b = orphanUpload(['disk' => 'public'], hoursAgo: 30);

    $this->artisan('attachments:purge-orphans')->expectsOutput('Deleted 2 orphaned attachment(s).')->assertSuccessful();

    Storage::disk('local')->assertMissing($a->path);
    Storage::disk('public')->assertMissing($b->path);
});

it('removes the row even when the file is already gone', function () {
    $stale = orphanUpload(hoursAgo: 30);
    Storage::disk('local')->delete([$stale->path, $stale->thumbnail_path]);

    $this->artisan('attachments:purge-orphans')->assertSuccessful();

    expect(Attachment::count())->toBe(0);
});

it('works through more uploads than fit in one batch', function () {
    config(['cleanup.chunk_size' => 3]);
    foreach (range(1, 8) as $_) {
        orphanUpload(hoursAgo: 30);
    }
    $kept = orphanUpload(hoursAgo: 1);

    $this->artisan('attachments:purge-orphans')->expectsOutput('Deleted 8 orphaned attachment(s).')->assertSuccessful();

    expect(Attachment::pluck('id')->all())->toBe([$kept->id]);
});

it('does not take an attachment away from a message that claims it in the meantime', function () {
    $racing = orphanUpload(hoursAgo: 30);
    $plain = orphanUpload(hoursAgo: 30);
    $message = addMessage($this->chat, $this->alice);

    // After the purge has listed its candidates but before it locks them, a message claims one.
    $claimed = false;
    Attachment::retrieved(function (Attachment $attachment) use (&$claimed, $racing, $message) {
        if (! $claimed) {
            $claimed = true;
            DB::table('attachments')->where('id', $racing->id)->update(['message_id' => $message->id]);
        }
    });

    $this->artisan('attachments:purge-orphans')->expectsOutput('Deleted 1 orphaned attachment(s).')->assertSuccessful();

    expect(Attachment::find($racing->id)?->message_id)->toBe($message->id)
        ->and(Attachment::find($plain->id))->toBeNull();
    Storage::disk('local')->assertExists([$racing->path, $racing->thumbnail_path]);
});

it('is safe to run twice', function () {
    orphanUpload(hoursAgo: 30);

    $this->artisan('attachments:purge-orphans')->assertSuccessful();
    $this->artisan('attachments:purge-orphans')->expectsOutput('Deleted 0 orphaned attachment(s).')->assertSuccessful();
});
