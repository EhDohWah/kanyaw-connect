<?php

namespace App\Http\Requests\Devices;

use App\Models\Device;
use App\Rules\Base64Bytes;
use App\Services\SignedPrekeyVerifier;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class RotateSignedPrekeyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:manage,device route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        /** @var Device $device */
        $device = $this->route('device');

        return [
            // A new key gets a new id, so a client can tell which one a sender used.
            'id' => ['required', 'integer', 'between:0,2147483647', "not_in:{$device->signed_prekey_id}"],
            'public_key' => ['required', new Base64Bytes(32)],
            'signature' => ['required', new Base64Bytes(64)],
        ];
    }

    public function messages(): array
    {
        return ['id.not_in' => 'The signed prekey id must differ from the current one.'];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            if (! app(SignedPrekeyVerifier::class)->isValid($this->route('device')->identity_public_key, $this->input('public_key'), $this->input('signature'))) {
                $validator->errors()->add('signature', 'The signature does not match the signed prekey and the device\'s identity key.');
            }
        }];
    }
}
