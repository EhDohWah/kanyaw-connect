<?php

namespace App\Http\Requests\Attachments;

use Illuminate\Foundation\Http\FormRequest;

class StoreAttachmentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // membership is enforced by the can:view,chat route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'max:'.config('chat.attachments.max_kilobytes')],
            // Opaque, client-defined data for encrypted chats (e.g. a wrapped file key). Not interpreted.
            'encrypted_key' => $this->route('chat')->is_encrypted ? ['nullable', 'string', 'max:4096'] : ['prohibited'],
        ];
    }
}
