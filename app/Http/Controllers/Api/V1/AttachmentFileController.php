<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Attachment;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Serves attachment bytes. Access is by signed URL (see Attachment::fileUrl), so these
 * routes carry no bearer token and can be used directly as <img src> / <audio src>.
 */
class AttachmentFileController extends Controller
{
    /** Types a browser may display inline; everything else is forced to download. */
    private const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/wav'];

    public function file(Attachment $attachment): StreamedResponse
    {
        $inline = in_array($attachment->mime_type, self::INLINE_TYPES, true);

        return $this->serve($attachment->disk, $attachment->path, $attachment->mime_type, $attachment->original_name, $inline);
    }

    public function thumbnail(Attachment $attachment): StreamedResponse
    {
        abort_unless($attachment->thumbnail_path, 404);

        return $this->serve($attachment->disk, $attachment->thumbnail_path, 'image/webp', 'thumbnail.webp', true);
    }

    private function serve(string $disk, string $path, string $mime, string $name, bool $inline): StreamedResponse
    {
        abort_unless(Storage::disk($disk)->exists($path), 404);

        return Storage::disk($disk)->response($path, $name, [
            'Content-Type' => $mime,
            // Stop browsers second-guessing the type, and neutralise any active content.
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            'Cache-Control' => 'private, max-age=3600',
        ], $inline ? 'inline' : 'attachment');
    }
}
