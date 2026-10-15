<?php

namespace App\Http\Requests\Devices;

use Illuminate\Foundation\Http\FormRequest;

class KeyBundlesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true; // enforced by the can:fetchKeyBundles,user route middleware
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // Optional: only claim prekeys for these devices (e.g. the ones named in an envelope_mismatch).
            'device_ids' => ['nullable', 'array', 'max:'.config('e2ee.max_devices_per_user')],
            'device_ids.*' => ['uuid', 'distinct'],
        ];
    }
}
