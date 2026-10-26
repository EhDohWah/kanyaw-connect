<?php

namespace App\Models;

use App\Enums\PushPlatform;
use App\Models\Concerns\HasMicrosecondTimestamps;
use Database\Factories\NativePushTokenFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One installation of the phone app, registered for native push: an FCM registration token on
 * Android, an APNs device token (plus a PushKit token for calls) on iOS. The tokens are never
 * returned by the API and never written to the log.
 */
#[Fillable(['user_id', 'personal_access_token_id', 'platform', 'token', 'voip_token', 'app_version', 'last_seen_at'])]
#[Hidden(['token', 'voip_token'])]
class NativePushToken extends Model
{
    /** @use HasFactory<NativePushTokenFactory> */
    use HasFactory, HasMicrosecondTimestamps, HasUuids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'platform' => PushPlatform::class,
            'last_seen_at' => 'immutable_datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
