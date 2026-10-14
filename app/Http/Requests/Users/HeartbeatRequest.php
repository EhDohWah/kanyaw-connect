<?php

namespace App\Http\Requests\Users;

use App\Enums\UserStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class HeartbeatRequest extends FormRequest
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
            // "offline" is not reportable: going offline is simply the heartbeat stopping.
            'status' => ['nullable', Rule::in([UserStatus::Online->value, UserStatus::Away->value, UserStatus::Busy->value])],
        ];
    }
}
