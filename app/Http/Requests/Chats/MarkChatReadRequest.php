<?php

namespace App\Http\Requests\Chats;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class MarkChatReadRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // membership is enforced by the can:view,chat route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The message must belong to this chat (it may since have been deleted).
            'message_id' => ['required', 'uuid', Rule::exists('messages', 'id')->where('chat_id', $this->route('chat')->id)],
        ];
    }
}
