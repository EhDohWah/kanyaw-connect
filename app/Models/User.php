<?php

namespace App\Models;

use App\Enums\UserStatus;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\HasApiTokens;

#[Fillable(['name', 'email', 'phone', 'password', 'timezone', 'locale', 'settings'])]
#[Hidden(['password', 'remember_token'])]
class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, HasUuids, Notifiable, SoftDeletes;

    /**
     * Default values so a freshly created model matches the database defaults.
     *
     * @var array<string, mixed>
     */
    protected $attributes = [
        'status' => 'offline',
        'timezone' => 'Asia/Bangkok',
        'locale' => 'en',
        'settings' => '{}',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'status' => UserStatus::class,
            'last_seen_at' => 'datetime',
            'settings' => 'array',
        ];
    }

    /**
     * Public URL of the original avatar, if one has been uploaded.
     */
    protected function avatarUrl(): Attribute
    {
        return Attribute::get(fn () => $this->avatar_path
            ? Storage::disk('public')->url($this->avatar_path)
            : null);
    }

    /**
     * Public URL of the 256x256 avatar thumbnail, if one has been uploaded.
     */
    protected function avatarThumbUrl(): Attribute
    {
        return Attribute::get(fn () => $this->avatar_path
            ? Storage::disk('public')->url(self::thumbnailPathFor($this->avatar_path))
            : null);
    }

    /**
     * The thumbnail lives next to the original: "<name>.<ext>" -> "<name>_256.webp".
     */
    public static function thumbnailPathFor(string $avatarPath): string
    {
        return preg_replace('/\.[^.\/]+$/', '', $avatarPath).'_256.webp';
    }
}
