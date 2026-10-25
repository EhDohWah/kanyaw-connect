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
     * Containers that hold audio as often as video. Content detection cannot tell an audio-only file in one of them
     * from a video (a browser's WebM voice recording is "video/webm", an MP4 with the common "isom" brand
     * "video/mp4"), so these are the only types the client's own declaration may turn into audio.
     */
    private const AUDIO_CONTAINERS = ['video/webm' => 'audio/webm', 'video/mp4' => 'audio/mp4', 'video/ogg' => 'audio/ogg'];

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
            'mime_type' => $encrypted ? 'application/octet-stream' : $this->typeOf($file),
            'encrypted_key' => $encrypted ? $encryptedKey : null,
        ]);

        if (! $encrypted && in_array($attachment->mime_type, self::THUMBNAILABLE, true)) {
            GenerateAttachmentThumbnail::dispatch($attachment);
        }

        return $attachment;
    }

    /**
     * The type is decided from the content. The client's declared type only settles one question the content cannot:
     * whether a WebM, MP4 or Ogg file is audio. The container family always stays the one the content proves.
     */
    private function typeOf(UploadedFile $file): string
    {
        $detected = $file->getMimeType() ?: 'application/octet-stream';
        $audio = self::AUDIO_CONTAINERS[$detected] ?? null;

        return $audio && str_starts_with(strtolower((string) $file->getClientMimeType()), 'audio/') ? $audio : $detected;
    }
}
