<?php

namespace App\Http\Requests\Chats;

use App\Enums\ChatRole;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateMemberRoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:changeRole,chat,user route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Ownership is not handed over here; the owner role is never assignable.
            'role' => ['required', Rule::in([ChatRole::Admin->value, ChatRole::Member->value])],
        ];
    }
}
