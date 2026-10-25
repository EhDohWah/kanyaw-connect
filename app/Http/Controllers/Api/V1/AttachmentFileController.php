<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Attachment;
use Illuminate\Support\Facades\Storage;
use League\Flysystem\Local\LocalFilesystemAdapter;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Serves attachment bytes. Access is by signed URL (see Attachment::fileUrl), so these
 * routes carry no bearer token and can be used directly as <img src> / <audio src>.
 */
class AttachmentFileController extends Controller
{
    /** Types a browser may display inline; everything else is forced to download. */
    private const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/wav'];

    public function file(Attachment $attachment): Response
    {
        $inline = in_array($attachment->mime_type, self::INLINE_TYPES, true);

        return $this->serve($attachment->disk, $attachment->path, $attachment->mime_type, $attachment->original_name, $inline);
    }

    public function thumbnail(Attachment $attachment): Response
    {
        abort_unless($attachment->thumbnail_path, 404);

        return $this->serve($attachment->disk, $attachment->thumbnail_path, 'image/webp', 'thumbnail.webp', true);
    }

    private function serve(string $disk, string $path, string $mime, string $name, bool $inline): Response
    {
        $storage = Storage::disk($disk);
        abort_unless($storage->exists($path), 404);

        $headers = [
            'Content-Type' => $mime,
            // Stop browsers second-guessing the type, and neutralise any active content.
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
            'Cache-Control' => 'private, max-age=3600',
        ];
        $disposition = $inline ? 'inline' : 'attachment';

        // A file on this server's disk is sent so that it answers byte ranges (206): Safari, on iPhones too, plays
        // audio and video only from servers that do, and the others use ranges to seek.
        if ($storage->getAdapter() instanceof LocalFilesystemAdapter) {
            $response = new BinaryFileResponse($storage->path($path), 200, $headers, false);
            $response->setContentDisposition($disposition, $name, $this->asciiName($name));

            return $response;
        }

        return $storage->response($path, $name, $headers, $disposition);
    }

    /** The file name for browsers that cannot read the UTF-8 one (Karen and Burmese names, say). */
    private function asciiName(string $name): string
    {
        $ascii = preg_replace('/[^\x20-\x7E]|[%\/\\\\]/', '_', $name) ?? '';

        return trim($ascii) === '' ? 'attachment' : $ascii;
    }
}
