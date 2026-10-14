<?php

namespace Database\Factories;

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Enums\RoomStatus;
use App\Enums\RoomType;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Room>
 */
class RoomFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'type' => RoomType::Instant,
            'name' => fake()->words(3, true),
            'host_id' => User::factory(),
            'status' => RoomStatus::Waiting,
            'max_participants' => 50,
            'livekit_room_name' => 'room-'.Str::uuid(),
        ];
    }

    /** Also create the host's participant row, as the real create flow does. */
    public function configure(): static
    {
        return $this->afterCreating(function (Room $room) {
            RoomParticipant::firstOrCreate(
                ['room_id' => $room->id, 'user_id' => $room->host_id],
                ['role' => RoomRole::Host, 'admission' => RoomAdmission::Admitted],
            );
        });
    }

    public function scheduled(?\DateTimeInterface $at = null): static
    {
        return $this->state(fn () => ['type' => RoomType::Scheduled, 'scheduled_at' => $at ?? now()->addDay()]);
    }

    public function active(): static
    {
        return $this->state(fn () => ['status' => RoomStatus::Active, 'started_at' => now()->subMinutes(5)]);
    }

    public function ended(): static
    {
        return $this->state(fn () => ['status' => RoomStatus::Ended, 'started_at' => now()->subHour(), 'ended_at' => now()->subMinutes(5)]);
    }

    public function withPassword(string $password = 'open-sesame'): static
    {
        return $this->state(fn () => ['password' => $password]);
    }
}
