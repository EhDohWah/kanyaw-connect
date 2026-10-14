<?php

namespace App\Http\Requests\Rooms;

use App\Enums\RoomAdmission;
use App\Models\Room;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Hash;

class JoinRoomRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:join,room route middleware
    }

    /**
     * The password is required exactly when the room has one and this person has not already got
     * past it: the host (who set it) and anyone who already asked to join (admitted or waiting,
     * which they could only do by giving it) are not asked again, so reconnecting after a dropped
     * connection and the "you were admitted, join again" step need no password.
     *
     * Built from the room here rather than with `required_if`, which cannot read a model attribute.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        /** @var Room $room */
        $room = $this->route('room');
        $participant = $room->participantFor($this->user());
        $alreadyThrough = $participant && $participant->admission !== RoomAdmission::Denied;

        if (! $room->hasPassword() || $alreadyThrough) {
            return ['password' => ['nullable', 'string']];
        }

        return [
            'password' => [
                'required', 'string',
                function (string $attribute, mixed $value, \Closure $fail) use ($room) {
                    if (! Hash::check($value, $room->password)) {
                        $fail('The room password is incorrect.');
                    }
                },
            ],
        ];
    }
}
