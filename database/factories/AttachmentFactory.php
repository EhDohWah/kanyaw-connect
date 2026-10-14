<?php

namespace Database\Factories;

use App\Models\Attachment;
use App\Models\Chat;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Attachment>
 */
class AttachmentFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'chat_id' => Chat::factory(),
            'uploader_id' => User::factory(),
            'disk' => 'local',
            'path' => 'chat-attachments/test/'.Str::uuid().'.bin',
            'original_name' => 'file.bin',
            'size' => 1024,
            'mime_type' => 'application/octet-stream',
        ];
    }

    public function image(): static
    {
        return $this->state(fn () => ['original_name' => 'photo.png', 'mime_type' => 'image/png']);
    }
}
