<?php

namespace App\Http\Resources;

use App\Models\Room;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A room as the authenticated user sees it. Load through RoomQueryService so that host,
 * present_count and my_participation are filled in. Never exposes the password or LiveKit name.
 *
 * @mixin Room
 */
class RoomResource extends JsonResource
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
            'host' => $this->whenLoaded('host', fn () => $this->host ? new PublicUserResource($this->host) : null),
            'host_id' => $this->host_id,
            'chat_id' => $this->chat_id,
            'has_password' => $this->hasPassword(),
            'waiting_room_enabled' => $this->waiting_room_enabled,
            'is_locked' => $this->is_locked,
            'max_participants' => $this->max_participants,
            'scheduled_at' => $this->scheduled_at,
            'duration_minutes' => $this->duration_minutes,
            'status' => $this->status,
            'started_at' => $this->started_at,
            'ended_at' => $this->ended_at,
            'recording_enabled' => $this->recording_enabled,
            'created_at' => $this->created_at,
            // How many people are connected right now (per the LiveKit webhooks).
            'present_count' => $this->when(array_key_exists('present_count', $this->getAttributes()), fn () => (int) $this->present_count),
            // The viewer's own standing: null if they have not asked to join.
            'my_participation' => $this->whenLoaded('myParticipant', fn () => $this->myParticipant ? [
                'role' => $this->myParticipant->role,
                'admission' => $this->myParticipant->admission,
            ] : null),
            // Only loaded for the host and co-hosts.
            'waiting_participants' => RoomParticipantResource::collection($this->whenLoaded('waitingParticipants')),
        ];
    }
}
