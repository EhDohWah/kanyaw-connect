<?php

namespace App\Actions\Cleanup;

use App\Models\Attachment;
use App\Models\Message;
use App\Services\AttachmentStorage;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class PurgeDeletedMessages
{
    public function __construct(private AttachmentStorage $storage) {}

    /**
     * Remove messages that were deleted more than `cleanup.deleted_messages_days` ago, for good,
     * together with what hangs off them: encrypted envelopes (the database removes those with the
     * message) and attachment files. Replies to a purged message simply lose their quoted original.
     *
     * Files are deleted before the rows that name them, in one transaction per batch: if a file
     * cannot be removed the batch is rolled back and tried again on the next run, so no file is
     * left behind with nothing pointing at it.
     *
     * @return array{messages: int, attachments: int}
     */
    public function handle(): array
    {
        $cutoff = now()->subDays(config('cleanup.deleted_messages_days'));
        $purged = ['messages' => 0, 'attachments' => 0];

        Message::onlyTrashed()
            ->where('deleted_at', '<', $cutoff)
            ->chunkById(config('cleanup.chunk_size'), function (Collection $messages) use (&$purged) {
                DB::transaction(function () use ($messages, &$purged) {
                    $attachments = Attachment::whereIn('message_id', $messages->modelKeys())->get();

                    $this->storage->deleteFiles($attachments);
                    Attachment::whereIn('id', $attachments->modelKeys())->delete();
                    $purged['messages'] += Message::onlyTrashed()->whereIn('id', $messages->modelKeys())->forceDelete();
                    $purged['attachments'] += $attachments->count();
                });
            });

        return $purged;
    }
}
