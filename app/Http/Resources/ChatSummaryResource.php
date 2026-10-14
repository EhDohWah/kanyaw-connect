<?php

namespace App\Http\Resources;

use App\Models\Chat;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A chat without anything specific to one viewer (no unread count, membership or latest message),
 * so the same payload can be broadcast to every member.
 *
 * @mixin Chat
 */
class ChatSummaryResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'type' => $this->type,
            'name' => $this->name,
            'description' => $this->description,
            'avatar_url' => $this->avatarUrl(),
            'is_encrypted' => $this->is_encrypted,
            'member_count' => $this->member_count,
            'last_message_at' => $this->last_message_at,
        ];
    }
}
