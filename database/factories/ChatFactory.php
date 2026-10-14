<?php

namespace Database\Factories;

use App\Enums\ChatType;
use App\Models\Chat;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Chat>
 */
class ChatFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'type' => ChatType::Group,
            'name' => fake()->words(2, true),
            'last_message_at' => now(),
        ];
    }

    public function group(): static
    {
        return $this->state(fn () => ['type' => ChatType::Group]);
    }

    /** Pass the two users so the unique direct_key is set. */
    public function direct(?string $userA = null, ?string $userB = null): static
    {
        return $this->state(fn () => [
            'type' => ChatType::Direct,
            'name' => null,
            'direct_key' => $userA && $userB ? Chat::directKeyFor($userA, $userB) : null,
            'member_count' => 2,
        ]);
    }
}
