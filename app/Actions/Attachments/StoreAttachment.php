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

    /**
     * In an encrypted chat the upload is an opaque encrypted blob: the server does not look at it, does
     * not trust the client's name or type for it, and makes no thumbnail. (Clients keep the real file
     * name and type inside the encrypted message.) `$encryptedKey` is stored and returned untouched.
     */
    public function handle(Chat $chat, User $uploader, UploadedFile $file, ?string $encryptedKey = null): Attachment
    {
        $disk = config('chat.attachments.disk');
        $encrypted = $chat->is_encrypted;

        // The stored name is random and its extension comes from the file's content,
        // never from the client-supplied name.
        $extension = $encrypted ? 'bin' : ($file->guessExtension() ?: 'bin');
        $path = $file->storeAs("chat-attachments/{$chat->getKey()}", Str::uuid().'.'.$extension, $disk);

        $attachment = Attachment::create([
            'chat_id' => $chat->getKey(),
            'uploader_id' => $uploader->getKey(),
            'disk' => $disk,
            'path' => $path,
            'original_name' => $encrypted ? 'attachment' : Str::limit($file->getClientOriginalName(), 200, ''),
            'size' => $file->getSize(),
            'mime_type' => $encrypted ? 'application/octet-stream' : ($file->getMimeType() ?: 'application/octet-stream'),
            'encrypted_key' => $encrypted ? $encryptedKey : null,
        ]);

        if (! $encrypted && in_array($attachment->mime_type, self::THUMBNAILABLE, true)) {
            GenerateAttachmentThumbnail::dispatch($attachment);
        }

        return $attachment;
    }
}
