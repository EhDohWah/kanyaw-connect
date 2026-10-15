<?php

namespace App\Services;

use App\Models\Attachment;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Storage;

/**
 * Removes attachment files (and their thumbnails) from whichever disk they are on.
 */
class AttachmentStorage
{
    /**
     * Delete the files of these attachments. A file that is already gone is not an error; a disk
     * that cannot be written to is, so the caller keeps the database rows and tries again later.
     *
     * @param  Collection<int, Attachment>  $attachments
     */
    public function deleteFiles(Collection $attachments): void
    {
        $attachments->groupBy('disk')->each(function (Collection $onDisk, string $disk) {
            $paths = $onDisk->flatMap(fn (Attachment $a) => [$a->path, $a->thumbnail_path])->filter()->values()->all();

            if ($paths !== [] && ! Storage::disk($disk)->delete($paths)) {
                // Local disks report false when something could not be removed; a missing file is not one.
                $remaining = array_filter($paths, fn (string $path) => Storage::disk($disk)->exists($path));

                if ($remaining !== []) {
                    throw new \RuntimeException("Could not delete attachment files from disk [{$disk}].");
                }
            }
        });
    }
}
