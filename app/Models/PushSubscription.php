<?php

namespace App\Models;

use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\PushSubscriptionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One browser's web-push subscription. Payloads are encrypted to `p256dh_key` / `auth_key`, which
 * only that browser can decrypt.
 */
#[Fillable(['user_id', 'access_token_id', 'endpoint', 'p256dh_key', 'auth_key'])]
#[Hidden(['p256dh_key', 'auth_key'])]
class PushSubscription extends Model
{
    /** @use HasFactory<PushSubscriptionFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['auth_key' => 'encrypted'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
