<?php

namespace App\Http\Resources;

use App\Models\Attachment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Attachment
 */
class AttachmentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'original_name' => $this->original_name,
            'mime_type' => $this->mime_type,
            'size' => $this->size,
            // Short-lived signed URLs; fetch the message again to get fresh ones.
            'url' => $this->fileUrl(),
            // Null until the queued thumbnail job has run (and always null for non-images).
            'thumbnail_url' => $this->thumbnailUrl(),
            // Opaque data the uploader attached (encrypted chats only).
            'encrypted_key' => $this->when($this->encrypted_key !== null, $this->encrypted_key),
            'created_at' => $this->created_at,
        ];
    }
}
