<?php

namespace Database\Factories;

use App\Enums\CallEndReason;
use App\Enums\CallKind;
use App\Enums\CallStatus;
use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Models\Call;
use App\Models\Chat;
use App\Models\Room;
use App\Models\RoomParticipant;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A call in a direct chat, with its two-seat room, as StartCall makes it. Pass `chat_id`,
 * `caller_id` and `callee_id` together (makeDirect() in tests gives the chat and its two members).
 *
 * @extends Factory<Call>
 */
class CallFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'chat_id' => Chat::factory(),
            'caller_id' => fn (array $attributes) => Chat::find($attributes['chat_id'])->members()->value('users.id'),
            'callee_id' => fn (array $attributes) => Chat::find($attributes['chat_id'])->members()->where('users.id', '!=', $attributes['caller_id'])->value('users.id'),
            'room_id' => fn (array $attributes) => Room::factory()->create([
                'name' => 'Call',
                'host_id' => $attributes['caller_id'],
                'chat_id' => $attributes['chat_id'],
                'max_participants' => 2,
                'livekit_room_name' => 'kc-call-'.Str::uuid(),
            ])->getKey(),
            'kind' => CallKind::Video,
            'status' => CallStatus::Ringing,
            'ring_expires_at' => now()->addSeconds(config('calls.ring_seconds')),
        ];
    }

    /** The callee is admitted to the room too, as the real start flow does. */
    public function configure(): static
    {
        return $this->afterCreating(function (Call $call) {
            RoomParticipant::firstOrCreate(
                ['room_id' => $call->room_id, 'user_id' => $call->callee_id],
                ['role' => RoomRole::Participant, 'admission' => RoomAdmission::Admitted],
            );
        });
    }

    public function voice(): static
    {
        return $this->state(fn () => ['kind' => CallKind::Voice]);
    }

    public function ongoing(): static
    {
        return $this->state(fn () => ['status' => CallStatus::Ongoing, 'answered_at' => now()->subMinute()]);
    }

    public function ended(CallEndReason $reason = CallEndReason::HungUp): static
    {
        return $this->state(fn () => [
            'status' => CallStatus::Ended,
            'end_reason' => $reason,
            'answered_at' => now()->subMinutes(3),
            'ended_at' => now()->subMinute(),
        ]);
    }

    public function missed(CallEndReason $reason = CallEndReason::NoAnswer): static
    {
        return $this->state(fn () => ['status' => CallStatus::Missed, 'end_reason' => $reason, 'ended_at' => now()]);
    }
}
