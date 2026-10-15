<?php

namespace App\Actions\Rooms;

use App\Actions\Push\NotifyMessageRecipients;
use App\Enums\MessageType;
use App\Enums\RoomAdmission;
use App\Enums\RoomAuditAction;
use App\Enums\RoomRole;
use App\Enums\RoomType;
use App\Models\Message;
use App\Models\Room;
use App\Models\User;
use App\Services\ChatBroadcaster;
use App\Services\RoomAuditor;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CreateRoom
{
    public function __construct(private ChatBroadcaster $chatBroadcaster, private NotifyMessageRecipients $notifier, private RoomAuditor $auditor) {}

    /**
     * Create a room with the creator as host. If it is linked to a chat, every member of that chat
     * is invited (invitation is derived from chat membership, so no rows are written per member) and
     * a system message announces the room in the chat.
     *
     * The LiveKit room itself is created lazily when the first person is given a token.
     *
     * @param  array<string, mixed>  $data  validated input
     */
    public function handle(User $host, array $data): Room
    {
        $announcement = null;

        $room = DB::transaction(function () use ($host, $data, &$announcement) {
            $scheduledAt = $data['scheduled_at'] ?? null;

            $room = Room::create([
                'type' => $data['type'] ?? ($scheduledAt ? RoomType::Scheduled : RoomType::Instant),
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'host_id' => $host->getKey(),
                'chat_id' => $data['chat_id'] ?? null,
                'password' => $data['password'] ?? null,
                'waiting_room_enabled' => $data['waiting_room_enabled'] ?? false,
                'max_participants' => $data['max_participants'] ?? config('rooms.default_max_participants'),
                'scheduled_at' => $scheduledAt,
                'duration_minutes' => $data['duration_minutes'] ?? null,
                'livekit_room_name' => 'kc-'.Str::uuid(),
            ]);

            $room->participants()->create([
                'user_id' => $host->getKey(),
                'role' => RoomRole::Host,
                'admission' => RoomAdmission::Admitted,
            ]);

            $this->auditor->record($room, RoomAuditAction::Created, $host, null, [
                'type' => $room->type->value,
                'chat_id' => $room->chat_id,
                'waiting_room' => $room->waiting_room_enabled,
                'password_protected' => $room->hasPassword(),
                'max_participants' => $room->max_participants,
            ]);

            if ($room->chat_id) {
                $announcement = $this->announce($room, $host);
            }

            return $room;
        });

        if ($announcement) {
            $this->chatBroadcaster->messageSent($announcement);
            $this->notifier->handle($announcement, $host->getKey()); // the host started it; the others should know
        }

        return $room;
    }

    /**
     * Post "<host> started/scheduled a video room" into the chat. Clients should render it from
     * metadata (event, room_id, host_id); the content is an English fallback.
     */
    private function announce(Room $room, User $host): Message
    {
        $verb = $room->type === RoomType::Scheduled ? 'scheduled' : 'started';

        $message = Message::create([
            'chat_id' => $room->chat_id,
            'sender_id' => null,
            'type' => MessageType::System,
            'content' => "{$host->name} {$verb} a video room: {$room->name}",
            'metadata' => ['event' => 'room_created', 'room_id' => $room->getKey(), 'host_id' => $host->getKey()],
        ]);

        $room->chat->bumpLastMessageAt($message->created_at);

        return $message;
    }
}
