<?php

namespace App\Http\Requests\Calls;

use App\Enums\CallKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StartCallRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:view,chat and can:call,chat route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'kind' => ['required', 'string', Rule::enum(CallKind::class)],
        ];
    }
}
