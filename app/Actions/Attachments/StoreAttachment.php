<?php

namespace App\Actions\Attachments;

use App\Jobs\GenerateAttachmentThumbnail;
use App\Models\Attachment;
use App\Models\Chat;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

class StoreAttachment
{
    /** Raster formats the thumbnail job can handle. */
    public const THUMBNAILABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

    public function handle(Chat $chat, User $uploader, UploadedFile $file): Attachment
    {
        $disk = config('chat.attachments.disk');

        // The stored name is random and its extension comes from the file's content,
        // never from the client-supplied name.
        $extension = $file->guessExtension() ?: 'bin';
        $path = $file->storeAs("chat-attachments/{$chat->getKey()}", Str::uuid().'.'.$extension, $disk);

        $attachment = Attachment::create([
            'chat_id' => $chat->getKey(),
            'uploader_id' => $uploader->getKey(),
            'disk' => $disk,
            'path' => $path,
            'original_name' => Str::limit($file->getClientOriginalName(), 200, ''),
            'size' => $file->getSize(),
            'mime_type' => $file->getMimeType() ?: 'application/octet-stream',
        ]);

        if (in_array($attachment->mime_type, self::THUMBNAILABLE, true)) {
            GenerateAttachmentThumbnail::dispatch($attachment);
        }

        return $attachment;
    }
}
