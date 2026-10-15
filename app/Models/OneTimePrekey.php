<?php

namespace App\Models;

use App\Models\Concerns\HasMicrosecondTimestamps;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A public one-time prekey. Each is handed out to at most one person, ever.
 */
#[Fillable(['device_id', 'key_id', 'public_key', 'claimed_at', 'claimed_by_device_id', 'created_at'])]
class OneTimePrekey extends Model
{
    use HasMicrosecondTimestamps, HasUuids;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['key_id' => 'integer', 'claimed_at' => 'datetime', 'created_at' => 'datetime'];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(Device::class);
    }

    public function claimedBy(): BelongsTo
    {
        return $this->belongsTo(Device::class, 'claimed_by_device_id');
    }
}
