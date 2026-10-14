<?php

namespace App\Http\Requests\Rooms;

use App\Enums\RoomType;
use App\Models\Chat;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class StoreRoomRequest extends FormRequest
{
    /**
     * A room linked to a chat can only be created by a member of that chat. A chat that does not
     * exist gets the same 403, so this cannot be used to probe for chat ids.
     */
    public function authorize(): bool
    {
        $chatId = $this->input('chat_id');

        if (! is_string($chatId) || ! Str::isUuid($chatId)) {
            return true; // not a usable id: validation reports it
        }

        $chat = Chat::find($chatId);

        return $chat !== null && $chat->membershipOf($this->user()) !== null;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $scheduled = $this->input('type') === RoomType::Scheduled->value;

        return [
            'name' => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:1000'],
            // Optional: a room with scheduled_at is scheduled, otherwise it is instant.
            'type' => ['nullable', Rule::enum(RoomType::class)],
            'scheduled_at' => [
                $scheduled ? 'required' : 'nullable',
                'date',
                'after:now',
                'prohibited_if:type,'.RoomType::Instant->value,
            ],
            'duration_minutes' => ['nullable', 'integer', 'between:5,1440'],
            'chat_id' => ['nullable', 'uuid', Rule::exists('chats', 'id')->whereNull('deleted_at')],
            'password' => ['nullable', 'string', 'min:4', 'max:64'],
            'waiting_room_enabled' => ['nullable', 'boolean'],
            'max_participants' => ['nullable', 'integer', 'between:2,'.config('rooms.max_participants')],
        ];
    }
}
