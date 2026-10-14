<?php

namespace App\Http\Requests\Chats;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class AddMembersRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:addMembers,chat route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'user_ids' => ['required', 'array', 'min:1', 'max:50'],
            'user_ids.*' => ['uuid', 'distinct', Rule::exists('users', 'id')->whereNull('deleted_at')],
        ];
    }
}
