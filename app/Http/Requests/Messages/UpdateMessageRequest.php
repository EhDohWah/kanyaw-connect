<?php

namespace App\Http\Requests\Messages;

use App\Enums\MessageType;
use Illuminate\Foundation\Http\FormRequest;

class UpdateMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:update,message route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // A text message cannot be emptied; a media message may drop its caption.
        $isText = $this->route('message')->type === MessageType::Text;

        return [
            'content' => [$isText ? 'required' : 'nullable', 'string', 'max:5000'],
        ];
    }
}
