<?php

namespace App\Http\Resources;

use App\Models\Chat;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A chat as seen by the authenticated user. Load it through ChatListService so that
 * my_membership, unread_count, latest_message and other_user are filled in.
 *
 * @mixin Chat
 */
class ChatResource extends JsonResource
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
            'created_at' => $this->created_at,
            'unread_count' => $this->when(array_key_exists('unread_count', $this->getAttributes()), fn () => (int) $this->unread_count),
            'my_membership' => $this->whenLoaded('myMembership', fn () => new MyMembershipResource($this->myMembership)),
            'latest_message' => $this->whenLoaded('latestMessage', fn () => $this->latestMessage ? new MessageResource($this->latestMessage) : null),
            // The person you are talking to; only present on direct chats.
            'other_user' => $this->whenLoaded('otherUser', fn () => $this->otherUser ? new PublicUserResource($this->otherUser) : null),
            // Full member list; only loaded on the single-chat endpoint.
            'members' => ChatMemberResource::collection($this->whenLoaded('chatMembers')),
        ];
    }
}
