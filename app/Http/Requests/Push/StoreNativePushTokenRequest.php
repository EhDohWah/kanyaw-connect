<?php

namespace App\Http\Requests\Push;

use App\Enums\PushPlatform;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * The phone app registers itself after sign-in: { platform, token, voip_token?, app_version? }.
 */
class StoreNativePushTokenRequest extends FormRequest
{
    /**
     * The registration is tied to the login it was made with, so signing out removes it. That needs
     * a stored bearer token, which is what the phone app always signs in with.
     */
    public function authorize(): Response
    {
        $token = $this->user()?->currentAccessToken();

        return $token instanceof PersonalAccessToken && $token->exists
            ? Response::allow()
            : Response::deny('Registering a phone for push needs a bearer token.');
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'platform' => ['required', Rule::enum(PushPlatform::class)],
            // FCM registration tokens are about 160 characters and APNs tokens 64 hex digits today;
            // neither service promises a length, so allow room.
            'token' => ['required', 'string', 'max:4096'],
            'voip_token' => ['nullable', 'string', 'max:4096', 'prohibited_unless:platform,ios'],
            'app_version' => ['nullable', 'string', 'max:32'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'voip_token.prohibited_unless' => __('Only an iPhone has a VoIP (PushKit) token.'),
        ];
    }
}
