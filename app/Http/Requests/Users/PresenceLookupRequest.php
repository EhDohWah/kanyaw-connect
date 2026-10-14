<?php

namespace App\Http\Requests\Users;

use Illuminate\Foundation\Http\FormRequest;

class PresenceLookupRequest extends FormRequest
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
            'ids' => ['required', 'array', 'min:1', 'max:'.config('chat.presence.max_lookup')],
            'ids.*' => ['uuid', 'distinct'],
        ];
    }
}
