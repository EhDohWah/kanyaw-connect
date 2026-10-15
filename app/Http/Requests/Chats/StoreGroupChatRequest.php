<?php

namespace App\Http\Requests\Chats;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreGroupChatRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:1000'],
            // End-to-end encrypted chat. Fixed for the life of the chat.
            'is_encrypted' => ['nullable', 'boolean'],
            // The creator is added automatically as owner, so they must not list themselves.
            'member_ids' => ['required', 'array', 'min:1', 'max:'.(config('chat.max_group_members') - 1)],
            'member_ids.*' => [
                'uuid', 'distinct',
                Rule::notIn([$this->user()->id]),
                Rule::exists('users', 'id')->whereNull('deleted_at'),
            ],
        ];
    }

    public function messages(): array
    {
        return ['member_ids.*.not_in' => 'You are added to the group automatically; do not include yourself.'];
    }
}
