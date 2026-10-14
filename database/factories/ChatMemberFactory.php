<?php

namespace Database\Factories;

use App\Enums\ChatRole;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ChatMember>
 */
class ChatMemberFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'chat_id' => Chat::factory(),
            'user_id' => User::factory(),
            'role' => ChatRole::Member,
            'joined_at' => now(),
        ];
    }

    public function role(ChatRole $role): static
    {
        return $this->state(fn () => ['role' => $role]);
    }
}
