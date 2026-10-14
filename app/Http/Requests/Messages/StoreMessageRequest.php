<?php

namespace App\Http\Requests\Messages;

use App\Enums\MessageType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreMessageRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // membership is enforced by the can:view,chat route middleware
    }

    /**
     * Whether the attachment can still be claimed is checked in SendMessage, not here: a retried
     * request (same client_id) must succeed even though its attachment is already attached.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $isText = $this->input('type') === MessageType::Text->value;

        return [
            'client_id' => ['required', 'uuid'],
            'type' => ['required', Rule::in(MessageType::sendable())],
            'content' => [$isText ? 'required' : 'nullable', 'string', 'max:5000'],
            'reply_to_id' => [
                'nullable', 'uuid',
                Rule::exists('messages', 'id')->where('chat_id', $this->route('chat')->id)->whereNull('deleted_at'),
            ],
            'metadata' => ['exclude_if:type,text', 'array:attachment_id'],
            'metadata.attachment_id' => [Rule::requiredIf(! $isText && $this->input('type') !== null), 'uuid'],
        ];
    }

    public function messages(): array
    {
        return ['metadata.attachment_id.required' => 'Image, file and voice messages need metadata.attachment_id.'];
    }
}
