<?php

namespace App\Models;

use App\Models\Concerns\HasMicrosecondTimestamps;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An encrypted copy of one message for one device. The server never reads `ciphertext` or `header`:
 * it stores them and returns them to that device.
 */
#[Fillable(['message_id', 'recipient_device_id', 'ciphertext', 'header'])]
class MessageEnvelope extends Model
{
    use HasMicrosecondTimestamps, HasUuids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['header' => 'array'];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    public function recipientDevice(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'recipient_device_id');
    }
}
