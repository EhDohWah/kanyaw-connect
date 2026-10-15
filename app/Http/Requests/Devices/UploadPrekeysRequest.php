<?php

namespace App\Http\Requests\Devices;

use App\Models\Device;
use App\Rules\Base64Bytes;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UploadPrekeysRequest extends FormRequest
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
            'prekeys' => ['required', 'array', 'min:1', 'max:'.config('e2ee.prekeys.topup_max')],
            'prekeys.*' => ['array:id,public_key'],
            'prekeys.*.id' => [
                'required', 'integer', 'between:0,2147483647', 'distinct',
                // A key id is never reused for a device, even after it was claimed.
                Rule::unique('one_time_prekeys', 'key_id')->where('device_id', $device->getKey()),
            ],
            'prekeys.*.public_key' => ['required', new Base64Bytes(32), 'distinct'],
        ];
    }
}
