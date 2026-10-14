<?php

namespace App\Http\Requests\Rooms;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class MuteParticipantRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:moderate,room,user route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'kind' => ['nullable', Rule::in(['audio', 'video'])],
        ];
    }
}
