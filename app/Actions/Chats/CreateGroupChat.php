<?php

namespace App\Actions\Chats;

use App\Enums\ChatRole;
use App\Enums\ChatType;
use App\Models\Chat;
use App\Models\User;
use App\Services\ChatBroadcaster;
use Illuminate\Support\Facades\DB;

class CreateGroupChat
{
    public function __construct(private ChatBroadcaster $broadcaster) {}

    /**
     * @param  array{name: string, description?: string|null, is_encrypted?: bool, member_ids: list<string>}  $data
     */
    public function handle(User $creator, array $data): Chat
    {
        $chat = DB::transaction(function () use ($creator, $data) {
            $now = now();
            $memberIds = array_values(array_unique($data['member_ids']));

            $chat = Chat::create([
                'type' => ChatType::Group,
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'created_by' => $creator->getKey(),
                'is_encrypted' => $data['is_encrypted'] ?? false,
                'member_count' => count($memberIds) + 1,
                'last_message_at' => $now,
            ]);

            $chat->chatMembers()->create([
                'user_id' => $creator->getKey(),
                'role' => ChatRole::Owner,
                'joined_at' => $now,
                'last_read_at' => $now,
            ]);

            foreach ($memberIds as $userId) {
                $chat->chatMembers()->create([
                    'user_id' => $userId,
                    'role' => ChatRole::Member,
                    'joined_at' => $now,
                    'last_read_at' => $now,
                ]);
            }

            return $chat;
        });

        // Everyone but the creator learns about the new chat on their user channel.
        foreach (User::whereIn('id', $data['member_ids'])->get() as $member) {
            $this->broadcaster->memberAdded($chat, $member, toChat: false);
        }

        return $chat;
    }
}
