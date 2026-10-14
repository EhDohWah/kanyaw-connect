<?php

namespace App\Http\Requests\Users;

use Illuminate\Foundation\Http\FormRequest;

class UpdateAvatarRequest extends FormRequest
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
            // SVG is deliberately excluded (script injection risk). max is in kilobytes: 2 MB.
            'avatar' => [
                'required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048',
                'dimensions:max_width=6000,max_height=6000',
            ],
        ];
    }
}
