<?php

use App\Enums\ChatRole;
use App\Events\ChatMemberAdded;
use App\Events\ChatMemberRemoved;
use App\Events\ChatUpdated;
use App\Events\MessageDeleted;
use App\Events\MessageRead;
use App\Events\MessageSent;
use App\Events\MessageUpdated;
use App\Events\RoomAdmitted;
use App\Events\RoomDenied;
use App\Events\RoomEnded;
use App\Events\RoomJoinRequested;
use App\Events\RoomParticipantJoined;
use App\Events\RoomParticipantLeft;
use App\Events\RoomRoleChanged;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Device;
use App\Models\Message;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use App\Services\LiveKitService;
use Carbon\CarbonInterface;
use Firebase\JWT\JWT;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Broadcast;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\FakeLiveKitService;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

// Integration tests use real, separate database connections (they cannot run inside the
// transaction RefreshDatabase wraps around each test), so they manage and clean up their own data.
pest()->extend(TestCase::class)->in('Integration');

/** Authenticate as the given user (or a new one) for the following requests. */
function signIn(?User $user = null): User
{
    $user ??= User::factory()->create();
    Sanctum::actingAs($user);

    return $user;
}

/**
 * A group chat with the given people. Join times are staggered (owner first, then admins,
 * then members) so "who joined earliest" is deterministic.
 *
 * @param  list<User>  $members
 * @param  list<User>  $admins
 */
function makeGroup(User $owner, array $members = [], array $admins = [], array $attributes = []): Chat
{
    $chat = Chat::factory()->group()->create(array_merge([
        'created_by' => $owner->id,
        'member_count' => 1 + count($admins) + count($members),
    ], $attributes));

    $joined = now()->subHour();
    $add = function (User $user, ChatRole $role) use ($chat, &$joined) {
        ChatMember::factory()->role($role)->create([
            'chat_id' => $chat->id,
            'user_id' => $user->id,
            'joined_at' => $joined = $joined->copy()->addMinute(),
            'last_read_at' => $joined,
        ]);
    };

    $add($owner, ChatRole::Owner);
    array_map(fn (User $u) => $add($u, ChatRole::Admin), $admins);
    array_map(fn (User $u) => $add($u, ChatRole::Member), $members);

    return $chat;
}

function makeDirect(User $a, User $b, array $attributes = []): Chat
{
    $chat = Chat::factory()->direct($a->id, $b->id)->create(array_merge(['created_by' => $a->id], $attributes));

    foreach ([$a, $b] as $user) {
        ChatMember::factory()->create([
            'chat_id' => $chat->id,
            'user_id' => $user->id,
            'joined_at' => now()->subHour(),
            'last_read_at' => now()->subHour(),
        ]);
    }

    return $chat;
}

/** Insert a message directly (bypassing the API). Pass 'created_at' to place it in time. */
function addMessage(Chat $chat, ?User $sender, array $attributes = []): Message
{
    return Message::factory()->create(array_merge([
        'chat_id' => $chat->id,
        'sender_id' => $sender?->id,
    ], $attributes));
}

/** Number of SQL queries run by the callback. */
function countQueries(Closure $callback): int
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    $callback();
    $count = count(DB::getQueryLog());
    DB::disableQueryLog();

    return $count;
}

/** A date as a microsecond-precise string, for query-builder updates (see HasMicrosecondTimestamps). */
function ts(CarbonInterface $date): string
{
    return Message::microseconds($date);
}

/**
 * Record the chat broadcast events instead of publishing them. Only these classes are faked, so
 * Eloquent's own events (which generate UUIDs) keep working.
 */
function fakeBroadcasts(): void
{
    Event::fake([
        MessageSent::class, MessageUpdated::class, MessageDeleted::class, MessageRead::class,
        ChatUpdated::class, ChatMemberAdded::class, ChatMemberRemoved::class,
        RoomParticipantJoined::class, RoomParticipantLeft::class, RoomJoinRequested::class,
        RoomAdmitted::class, RoomDenied::class, RoomEnded::class, RoomRoleChanged::class,
    ]);
}

/** Channel names an event would be published on, e.g. "private-chat.<id>". */
function channelNames(object $event): array
{
    return array_map(fn ($channel) => $channel->name, $event->broadcastOn());
}

/** The event payload exactly as clients receive it, as an associative array. */
function payloadOf(object $event): array
{
    return json_decode(json_encode($event->broadcastWith()), true);
}

/**
 * The test environment broadcasts to a null driver, which authorises everything. To test channel
 * authorization, switch to the real Reverb driver (it only signs; no server is needed) and register
 * the channels on it.
 */
function useReverbForChannelAuth(): void
{
    config(['broadcasting.default' => 'reverb']);
    Broadcast::purge('null');
    require base_path('routes/channels.php');
}

/** Replace LiveKit with a recording fake that never touches the network. */
function fakeLiveKit(): FakeLiveKitService
{
    $fake = new FakeLiveKitService;
    app()->instance(LiveKitService::class, $fake);

    return $fake;
}

/**
 * A room with its host. Pass extra attributes to override defaults, e.g. ['status' => 'active'].
 * Use the returned room's `host` relation or $room->host_id for the host.
 */
function makeRoom(?User $host = null, array $attributes = []): Room
{
    return Room::factory()->create(array_merge(['host_id' => ($host ?? User::factory()->create())->id], $attributes));
}

/** Add a participant row to a room, optionally already connected to LiveKit. */
function addParticipant(Room $room, ?User $user = null, array $attributes = []): RoomParticipant
{
    return RoomParticipant::factory()->create(array_merge([
        'room_id' => $room->id,
        'user_id' => ($user ?? User::factory()->create())->id,
    ], $attributes));
}

/**
 * A webhook Authorization token shaped like LiveKit's: a JWT with the API key as issuer and the
 * base64 SHA-256 of the raw body in the `sha256` claim. It has no subject and no video grant.
 *
 * @param  array<string, mixed>  $overrides  claims to replace, e.g. ['exp' => time() - 60]
 */
function livekitWebhookToken(string $body, array $overrides = [], ?string $secret = null): string
{
    $now = time();

    return JWT::encode(array_merge([
        'iss' => config('services.livekit.api_key'),
        'nbf' => $now,
        'exp' => $now + 600,
        'sha256' => base64_encode(hash('sha256', $body, true)),
    ], $overrides), $secret ?? config('services.livekit.api_secret'), 'HS256');
}

/**
 * Deliver a LiveKit webhook to the app, signed the way the LiveKit server signs it.
 *
 * Options: 'secret' (sign with another secret), 'signedBody' (sign a different body than the one sent),
 * 'claims' (override token claims), 'authorization' (send this header value instead; null = none).
 *
 * @param  array<string, mixed>  $event  e.g. ['event' => 'participant_joined', 'room' => ['name' => '…'], …]
 */
function sendLiveKitWebhook($test, array $event, array $options = [])
{
    $body = json_encode(array_merge(['id' => 'EV_'.Str::random(8), 'createdAt' => (string) now()->timestamp], $event));
    $token = livekitWebhookToken($options['signedBody'] ?? $body, $options['claims'] ?? [], $options['secret'] ?? null);

    $headers = array_key_exists('authorization', $options)
        ? ($options['authorization'] === null ? [] : ['HTTP_AUTHORIZATION' => $options['authorization']])
        : ['HTTP_AUTHORIZATION' => $token];

    return $test->call('POST', '/api/v1/webhooks/livekit', [], [], [], $headers + ['CONTENT_TYPE' => 'application/webhook+json'], $body);
}

/** Shorthand for the two events that matter most. */
function livekitEvent(Room $room, string $name, ?User $user = null, array $extra = []): array
{
    return array_merge([
        'event' => $name,
        'room' => ['sid' => 'RM_test', 'name' => $room->livekit_room_name],
    ], $user ? ['participant' => ['sid' => 'PA_'.substr($user->id, 0, 8), 'identity' => $user->id]] : [], $extra);
}

/** A device for a user, with real libsodium public keys. Pass a prekey count to also create one-time prekeys. */
function makeDevice(?User $user = null, int $prekeys = 0, array $attributes = []): Device
{
    $factory = Device::factory();

    return ($prekeys > 0 ? $factory->withPrekeys($prekeys) : $factory)
        ->create(array_merge(['user_id' => ($user ?? User::factory()->create())->id], $attributes));
}

/** An end-to-end encrypted group / direct chat (the chat row only; members as in makeGroup / makeDirect). */
function makeEncryptedGroup(User $owner, array $members = [], array $admins = []): Chat
{
    return makeGroup($owner, $members, $admins, ['is_encrypted' => true]);
}

function makeEncryptedDirect(User $a, User $b): Chat
{
    $chat = makeDirect($a, $b, ['is_encrypted' => true]);
    $chat->update(['direct_key' => Chat::directKeyFor($a->id, $b->id, true)]);

    return $chat;
}

/**
 * Envelopes for the given devices, in the shape clients send. The "ciphertext" is random bytes: the
 * server must treat it as opaque, so tests do not need real encryption here.
 *
 * @param  iterable<Device>  $devices
 * @return list<array{recipient_device_id: string, ciphertext: string, header: array<string, mixed>}>
 */
function envelopesFor(iterable $devices): array
{
    $envelopes = [];

    foreach ($devices as $device) {
        $envelopes[] = [
            'recipient_device_id' => $device->id,
            'ciphertext' => base64_encode(random_bytes(48)),
            'header' => ['alg' => 'test-x25519-xsalsa20poly1305', 'nonce' => base64_encode(random_bytes(24)), 'ephemeral_key' => base64_encode(random_bytes(32)), 'prekey_id' => 7],
        ];
    }

    return $envelopes;
}

/** Send an encrypted message from a device. */
function sendEncrypted($test, Chat $chat, Device $from, array $envelopes, array $overrides = [], ?string $deviceHeader = null)
{
    return $test->withHeader('X-Device-Id', $deviceHeader ?? $from->id)->postJson("/api/v1/chats/{$chat->id}/messages", array_merge([
        'client_id' => (string) Str::uuid(),
        'type' => 'text',
        'envelopes' => $envelopes,
    ], $overrides));
}
