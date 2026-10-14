<?php

namespace App\Actions\Chats;

use App\Enums\ChatRole;
use App\Enums\ChatType;
use App\Models\Chat;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class CreateGroupChat
{
    /**
     * @param  array{name: string, description?: string|null, member_ids: list<string>}  $data
     */
    public function handle(User $creator, array $data): Chat
    {
        return DB::transaction(function () use ($creator, $data) {
            $now = now();
            $memberIds = array_values(array_unique($data['member_ids']));

            $chat = Chat::create([
                'type' => ChatType::Group,
                'name' => $data['name'],
                'description' => $data['description'] ?? null,
                'created_by' => $creator->getKey(),
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
    }
}
