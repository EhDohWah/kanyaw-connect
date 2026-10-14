<?php

namespace App\Actions\Chats;

use App\Enums\ChatRole;
use App\Enums\ChatType;
use App\Models\Chat;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

class CreateDirectChat
{
    /**
     * Find or create the direct chat between two users.
     *
     * @return array{0: Chat, 1: bool} the chat, and whether it was just created
     */
    public function handle(User $creator, User $other): array
    {
        $key = Chat::directKeyFor($creator->getKey(), $other->getKey());

        if ($existing = Chat::where('direct_key', $key)->first()) {
            return [$existing, false];
        }

        try {
            $chat = DB::transaction(function () use ($creator, $other, $key) {
                $now = now();

                $chat = Chat::create([
                    'type' => ChatType::Direct,
                    'created_by' => $creator->getKey(),
                    'direct_key' => $key,
                    'member_count' => 2,
                    'last_message_at' => $now,
                ]);

                foreach ([$creator, $other] as $user) {
                    $chat->chatMembers()->create([
                        'user_id' => $user->getKey(),
                        'role' => ChatRole::Member,
                        'joined_at' => $now,
                        'last_read_at' => $now,
                    ]);
                }

                return $chat;
            });
        } catch (UniqueConstraintViolationException $e) {
            // Both users started the chat at the same moment; the other request won.
            $existing = Chat::where('direct_key', $key)->first();

            if (! $existing) {
                throw $e;
            }

            return [$existing, false];
        }

        return [$chat, true];
    }
}
