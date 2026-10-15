<?php

namespace App\Http\Requests\Push;

use App\Rules\Base64UrlBytes;
use App\Rules\PushEndpoint;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The body is the browser's own `subscription.toJSON()`: { endpoint, keys: { p256dh, auth } }.
 * Other members of that object (such as expirationTime) are ignored.
 */
class StorePushSubscriptionRequest extends FormRequest
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
            'endpoint' => ['required', 'string', new PushEndpoint],
            'keys' => ['required', 'array'],
            // An uncompressed P-256 point (0x04 + X + Y), and the 16-byte auth secret.
            'keys.p256dh' => ['required', 'string', new Base64UrlBytes(65, "\x04")],
            'keys.auth' => ['required', 'string', new Base64UrlBytes(16)],
        ];
    }
}
