<?php

namespace App\Jobs;

use App\Models\Attachment;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\Attributes\DeleteWhenMissingModels;
use Illuminate\Queue\Attributes\Tries;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Format;
use Intervention\Image\ImageManager;

#[Tries(3)]
#[DeleteWhenMissingModels]
class GenerateAttachmentThumbnail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public Attachment $attachment)
    {
        $this->afterCommit();
    }

    public function handle(): void
    {
        $disk = Storage::disk($this->attachment->disk);
        $size = config('chat.attachments.thumbnail_size');

        // Fits inside size x size, keeps the aspect ratio, never enlarges.
        $thumbnail = ImageManager::usingDriver(Driver::class)
            ->decodeBinary($disk->get($this->attachment->path))
            ->scaleDown($size, $size)
            ->encodeUsingFormat(Format::WEBP, quality: 75);

        $thumbnailPath = preg_replace('/\.[^.\/]+$/', '', $this->attachment->path).'_thumb.webp';
        $disk->put($thumbnailPath, (string) $thumbnail);

        $this->attachment->update(['thumbnail_path' => $thumbnailPath]);
    }
}
