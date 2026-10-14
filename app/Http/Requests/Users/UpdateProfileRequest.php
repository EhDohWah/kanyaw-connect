<?php

namespace App\Http\Requests\Users;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // always acts on the authenticated user's own profile
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'phone' => [
                'sometimes', 'nullable', 'string', 'regex:/^\+?[0-9 \-]{6,20}$/',
                Rule::unique('users', 'phone')->ignore($this->user()->id),
            ],
            'timezone' => ['sometimes', 'required', 'timezone:all'],
            'locale' => ['sometimes', 'required', Rule::in(config('app.supported_locales'))],
            'settings' => ['sometimes', 'array', 'max:50'],
        ];
    }
}
