<?php

namespace App\Actions\Chats;

use App\Enums\ChatRole;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class RemoveChatMember
{
    /**
     * Remove a user from a group (used both for "leave" and for an admin removing someone).
     *
     * If the owner goes, ownership passes to the longest-standing admin, otherwise to the
     * longest-standing member. If nobody is left the chat is deleted.
     */
    public function handle(Chat $chat, User $user): void
    {
        DB::transaction(function () use ($chat, $user) {
            $locked = Chat::whereKey($chat->getKey())->lockForUpdate()->firstOrFail();

            $membership = $locked->chatMembers()->where('user_id', $user->getKey())->first();

            if (! $membership) {
                return; // already gone (e.g. a retried request)
            }

            $membership->delete();

            if ($membership->role === ChatRole::Owner) {
                $this->promoteSuccessor($locked);
            }

            $remaining = $locked->chatMembers()->count();
            $locked->update(['member_count' => $remaining]);

            if ($remaining === 0) {
                $locked->delete();
            }
        });
    }

    private function promoteSuccessor(Chat $chat): void
    {
        /** @var ChatMember|null $successor */
        $successor = $chat->chatMembers()
            ->orderByRaw("case role when 'admin' then 0 else 1 end")
            ->orderBy('joined_at')
            ->orderBy('id')
            ->first();

        $successor?->update(['role' => ChatRole::Owner]);
    }
}
