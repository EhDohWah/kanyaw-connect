<?php

namespace App\Models;

use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\DeviceFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One installation of the app for one user, with its public keys.
 */
#[Fillable([
    'user_id', 'name', 'identity_public_key', 'exchange_public_key', 'signed_prekey_id',
    'signed_prekey_public', 'signed_prekey_signature', 'signed_prekey_rotated_at', 'last_active_at', 'revoked_at',
])]
class Device extends Model
{
    /** @use HasFactory<DeviceFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'signed_prekey_id' => 'integer',
            'signed_prekey_rotated_at' => 'datetime',
            'last_active_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function oneTimePrekeys(): HasMany
    {
        return $this->hasMany(OneTimePrekey::class);
    }

    public function envelopes(): HasMany
    {
        return $this->hasMany(MessageEnvelope::class, 'recipient_device_id');
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    /** Devices that have not been revoked. */
    public function scopeActive(Builder $query): void
    {
        $query->whereNull('devices.revoked_at');
    }

    /** How many one-time prekeys nobody has claimed yet. */
    public function unclaimedPrekeyCount(): int
    {
        return $this->oneTimePrekeys()->whereNull('claimed_at')->count();
    }
}
