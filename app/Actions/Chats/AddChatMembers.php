<?php

namespace App\Actions\Chats;

use App\Enums\ChatRole;
use App\Models\Chat;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AddChatMembers
{
    /**
     * Add users to a group. Users who are already members are skipped, so the call is idempotent.
     *
     * New members start with everything before now marked as read, so a long history
     * does not show up as unread.
     *
     * @param  list<string>  $userIds
     *
     * @throws ValidationException when the group would exceed the member limit
     */
    public function handle(Chat $chat, array $userIds): Chat
    {
        return DB::transaction(function () use ($chat, $userIds) {
            // Serialise membership changes so the limit and member_count cannot race.
            $locked = Chat::whereKey($chat->getKey())->lockForUpdate()->firstOrFail();

            $existing = $locked->chatMembers()->whereIn('user_id', $userIds)->pluck('user_id')->all();
            $toAdd = array_values(array_diff(array_unique($userIds), $existing));

            if ($locked->chatMembers()->count() + count($toAdd) > config('chat.max_group_members')) {
                throw ValidationException::withMessages([
                    'user_ids' => ['A group can have at most '.config('chat.max_group_members').' members.'],
                ]);
            }

            $now = now();

            foreach ($toAdd as $userId) {
                $locked->chatMembers()->create([
                    'user_id' => $userId,
                    'role' => ChatRole::Member,
                    'joined_at' => $now,
                    'last_read_at' => $now,
                ]);
            }

            $locked->update(['member_count' => $locked->chatMembers()->count()]);

            return $locked;
        });
    }
}
