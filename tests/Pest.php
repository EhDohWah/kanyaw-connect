<?php

use App\Enums\ChatRole;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Message;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

pest()->extend(TestCase::class)
    ->use(RefreshDatabase::class)
    ->in('Feature');

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
