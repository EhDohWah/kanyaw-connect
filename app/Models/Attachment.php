<?php

namespace App\Models;

use Database\Factories\AttachmentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\URL;

#[Fillable(['chat_id', 'uploader_id', 'message_id', 'disk', 'path', 'original_name', 'size', 'mime_type', 'thumbnail_path', 'encrypted_key'])]
#[Hidden(['encrypted_key'])]
class Attachment extends Model
{
    /** @use HasFactory<AttachmentFactory> */
    use HasFactory, HasUuids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['size' => 'integer'];
    }

    public function chat(): BelongsTo
    {
        return $this->belongsTo(Chat::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploader_id');
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    public function isImage(): bool
    {
        return str_starts_with($this->mime_type, 'image/');
    }

    /** Short-lived signed URL for the file. Possession of the URL is the credential. */
    public function fileUrl(): string
    {
        return URL::temporarySignedRoute('attachments.file', now()->addMinutes(config('chat.attachments.url_ttl_minutes')), $this);
    }

    public function thumbnailUrl(): ?string
    {
        return $this->thumbnail_path
            ? URL::temporarySignedRoute('attachments.thumbnail', now()->addMinutes(config('chat.attachments.url_ttl_minutes')), $this)
            : null;
    }
}
