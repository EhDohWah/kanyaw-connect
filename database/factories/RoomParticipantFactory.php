<?php

namespace Database\Factories;

use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<RoomParticipant>
 */
class RoomParticipantFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'room_id' => Room::factory(),
            'user_id' => User::factory(),
            'role' => RoomRole::Participant,
            'admission' => RoomAdmission::Admitted,
        ];
    }

    public function role(RoomRole $role): static
    {
        return $this->state(fn () => ['role' => $role]);
    }

    public function admission(RoomAdmission $admission): static
    {
        return $this->state(fn () => ['admission' => $admission]);
    }

    /** Connected to LiveKit now (as a webhook would have recorded). */
    public function present(?\DateTimeInterface $since = null): static
    {
        return $this->state(fn () => ['joined_at' => $since ?? now()->subMinute(), 'left_at' => null]);
    }

    public function left(): static
    {
        return $this->state(fn () => ['joined_at' => now()->subMinutes(10), 'left_at' => now()->subMinute()]);
    }
}
