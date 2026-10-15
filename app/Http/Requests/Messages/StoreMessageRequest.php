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

        $rules = [
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

        return $this->route('chat')->is_encrypted ? $this->encryptedRules($rules) : $rules + ['envelopes' => ['prohibited']];
    }

    /**
     * In an encrypted chat the server never sees the content: `content` must be empty and the message
     * travels as one envelope per recipient device. Only sizes are checked, never what is inside.
     *
     * @param  array<string, mixed>  $rules
     * @return array<string, mixed>
     */
    private function encryptedRules(array $rules): array
    {
        $limits = config('e2ee.envelopes');

        return array_merge($rules, [
            'content' => ['nullable', 'prohibited'],
            // `present` (not `required`): an empty list is answered with a clear 409 instead of a 422.
            'envelopes' => ['present', 'array', "max:{$limits['max_per_message']}"],
            'envelopes.*' => ['array'],
            'envelopes.*.recipient_device_id' => ['required', 'uuid', 'distinct'],
            'envelopes.*.ciphertext' => [
                'required', 'string', "max:{$limits['max_ciphertext_chars']}",
                // Postgres text cannot hold a NUL byte. Clients send base64, which never contains one.
                function (string $attribute, mixed $value, \Closure $fail) {
                    if (is_string($value) && str_contains($value, "\0")) {
                        $fail('The :attribute must be text without NUL bytes (send base64).');
                    }
                },
            ],
            'envelopes.*.header' => [
                'required', 'array', 'min:1',
                function (string $attribute, mixed $value, \Closure $fail) use ($limits) {
                    if (strlen((string) json_encode($value)) > $limits['max_header_bytes']) {
                        $fail("The :attribute must be at most {$limits['max_header_bytes']} bytes.");
                    }
                },
            ],
        ]);
    }

    public function messages(): array
    {
        return [
            'content.prohibited' => 'Encrypted chats do not accept plaintext content. Send encrypted envelopes instead.',
            'envelopes.prohibited' => 'This chat is not encrypted, so it does not accept envelopes.',
            'metadata.attachment_id.required' => 'Image, file and voice messages need metadata.attachment_id.',
        ];
    }
}
