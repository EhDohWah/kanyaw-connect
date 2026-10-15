<?php

namespace App\Http\Requests\Devices;

use App\Rules\Base64Bytes;
use App\Services\SignedPrekeyVerifier;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class RegisterDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Every key and signature here is public. Private keys must never be sent to the server.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $prekeys = config('e2ee.prekeys');

        return [
            'name' => ['required', 'string', 'max:100'],
            'identity_public_key' => ['required', new Base64Bytes(32), Rule::unique('devices', 'identity_public_key')],
            'exchange_public_key' => ['required', new Base64Bytes(32)],
            'signed_prekey' => ['required', 'array:id,public_key,signature'],
            'signed_prekey.id' => ['required', 'integer', 'between:0,2147483647'],
            'signed_prekey.public_key' => ['required', new Base64Bytes(32)],
            'signed_prekey.signature' => ['required', new Base64Bytes(64)],
            'one_time_prekeys' => ['required', 'array', "min:{$prekeys['register_min']}", "max:{$prekeys['register_max']}"],
            'one_time_prekeys.*' => ['array:id,public_key'],
            'one_time_prekeys.*.id' => ['required', 'integer', 'between:0,2147483647', 'distinct'],
            'one_time_prekeys.*.public_key' => ['required', new Base64Bytes(32), 'distinct'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $prekey = $this->input('signed_prekey');

            if (! app(SignedPrekeyVerifier::class)->isValid($this->input('identity_public_key'), $prekey['public_key'], $prekey['signature'])) {
                $validator->errors()->add('signed_prekey.signature', 'The signature does not match the signed prekey and identity key.');
            }
        }];
    }
}
