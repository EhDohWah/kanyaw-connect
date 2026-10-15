<?php

namespace App\Http\Resources;

use App\Models\MessageEnvelope;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One device's encrypted copy of a message. `ciphertext` and `header` are returned exactly as the
 * sender stored them; the server cannot read either.
 *
 * @mixin MessageEnvelope
 */
class EnvelopeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'recipient_device_id' => $this->recipient_device_id,
            'ciphertext' => $this->ciphertext,
            'header' => $this->header,
        ];
    }
}
