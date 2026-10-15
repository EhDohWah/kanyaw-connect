<?php

namespace App\Actions\Cleanup;

use App\Models\Attachment;
use App\Services\AttachmentStorage;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

class PurgeOrphanAttachments
{
    public function __construct(private AttachmentStorage $storage) {}

    /**
     * Delete uploads that were never attached to a message and are older than
     * `cleanup.orphan_attachment_hours` (the user closed the app before sending, or the send failed).
     *
     * Each batch re-reads its rows under a lock and only deletes those still unattached, so a message
     * that claims an attachment at this very moment keeps it.
     *
     * @return int how many attachments were removed
     */
    public function handle(): int
    {
        $cutoff = now()->subHours(config('cleanup.orphan_attachment_hours'));
        $purged = 0;

        Attachment::whereNull('message_id')
            ->where('created_at', '<', $cutoff)
            ->chunkById(config('cleanup.chunk_size'), function (Collection $attachments) use (&$purged) {
                DB::transaction(function () use ($attachments, &$purged) {
                    $stillOrphans = Attachment::whereIn('id', $attachments->modelKeys())
                        ->whereNull('message_id')
                        ->lockForUpdate()
                        ->get();

                    $this->storage->deleteFiles($stillOrphans);
                    $purged += Attachment::whereIn('id', $stillOrphans->modelKeys())->delete();
                });
            });

        return $purged;
    }
}
