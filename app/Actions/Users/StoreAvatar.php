<?php

namespace App\Actions\Users;

use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Intervention\Image\Drivers\Gd\Driver;
use Intervention\Image\Format;
use Intervention\Image\ImageManager;

class StoreAvatar
{
    private const DISK = 'public';

    private const THUMBNAIL_SIZE = 256;

    /**
     * Store the original upload plus a 256x256 WebP thumbnail, replacing any previous avatar.
     */
    public function handle(User $user, UploadedFile $file): User
    {
        $disk = Storage::disk(self::DISK);
        $oldPath = $user->avatar_path;

        // Unique name per upload so clients and CDNs never serve a stale cached avatar.
        $extension = $file->guessExtension() ?: 'jpg';
        $path = $file->storeAs("avatars/{$user->id}", Str::uuid().'.'.$extension, self::DISK);

        $thumbnail = ImageManager::usingDriver(Driver::class)
            ->decodePath($file->getRealPath())
            ->cover(self::THUMBNAIL_SIZE, self::THUMBNAIL_SIZE)
            ->encodeUsingFormat(Format::WEBP, quality: 80);

        $disk->put(User::thumbnailPathFor($path), (string) $thumbnail);

        $user->forceFill(['avatar_path' => $path])->save();

        if ($oldPath) {
            $disk->delete([$oldPath, User::thumbnailPathFor($oldPath)]);
        }

        return $user;
    }
}
