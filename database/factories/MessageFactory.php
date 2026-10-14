<?php

namespace Database\Factories;

use App\Enums\MessageType;
use App\Models\Chat;
use App\Models\Message;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Message>
 */
class MessageFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'chat_id' => Chat::factory(),
            'sender_id' => User::factory(),
            'type' => MessageType::Text,
            'content' => fake()->sentence(),
            'client_id' => (string) Str::uuid(),
        ];
    }

    public function system(): static
    {
        return $this->state(fn () => ['type' => MessageType::System, 'sender_id' => null, 'client_id' => null]);
    }
}
