<?php

use App\Actions\Calls\AcceptCall;
use App\Actions\Calls\DeclineCall;
use App\Actions\Calls\StartCall;
use App\Enums\CallKind;
use App\Enums\CallStatus;
use App\Exceptions\CallConflictException;
use App\Models\Call;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Message;
use App\Models\Room;
use App\Models\User;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/*
| Real concurrency for calls: separate PHP processes, each with its own database connection, act on
| the same people or the same call at the same instant. Like PrekeyClaimConcurrencyTest, this cannot
| be a Feature test (those run inside one transaction on one connection), so the data is committed
| and cleaned up here.
*/

beforeEach(function () {
    if (! function_exists('pcntl_fork')) {
        $this->markTestSkipped('pcntl is required to fork competing processes.');
    }

    Artisan::call('migrate', ['--force' => true]);
    fakeLiveKit(); // inherited by the forked processes: nobody talks to a real LiveKit

    $this->users = [];
    $this->chats = [];
    $this->resultDir = sys_get_temp_dir().'/call-race-'.bin2hex(random_bytes(4));
    mkdir($this->resultDir);
});

afterEach(function () {
    $userIds = array_map(fn (User $user) => $user->id, $this->users ?? []);

    if ($userIds !== []) {
        Call::whereIn('caller_id', $userIds)->delete();
        Room::withTrashed()->whereIn('host_id', $userIds)->forceDelete(); // cascades to participants
        Chat::withTrashed()->whereIn('id', array_map(fn (Chat $chat) => $chat->id, $this->chats))->forceDelete(); // and messages, members
        User::withTrashed()->whereIn('id', $userIds)->forceDelete();
    }

    if (isset($this->resultDir)) {
        array_map('unlink', glob($this->resultDir.'/*') ?: []);
        @rmdir($this->resultDir);
    }
});

/** A committed user, removed again after the test. */
function racer($test): User
{
    return $test->users[] = User::factory()->create();
}

/** A committed direct chat between two people. */
function racingDirect($test, User $a, User $b): Chat
{
    $chat = Chat::factory()->direct($a->id, $b->id)->create(['created_by' => $a->id]);
    foreach ([$a, $b] as $user) {
        ChatMember::factory()->create(['chat_id' => $chat->id, 'user_id' => $user->id, 'joined_at' => now()->subHour()]);
    }

    return $test->chats[] = $chat;
}

/**
 * Start a call from inside a racing process. Models are loaded here, by id: a model made in the
 * parent remembers the parent's connection, and sharing its socket would garble both.
 */
function callFrom(string $chatId, string $callerId, CallKind $kind): string
{
    app(StartCall::class)->handle(Chat::findOrFail($chatId), User::findOrFail($callerId), $kind);

    return 'created';
}

/**
 * Run each closure in its own process at the same instant. Each returns a short string: what
 * happened to it ("created", "already_in_call", …).
 *
 * @param  list<Closure(): string>  $contenders
 * @return list<string>
 */
function race(string $resultDir, array $contenders): array
{
    $startAt = microtime(true) + 0.6;
    $pids = [];

    foreach ($contenders as $index => $contender) {
        $pid = pcntl_fork();

        if ($pid === 0) {
            // CHILD: a connection of its own (the inherited one belongs to the parent). Ends with
            // SIGKILL so no destructor can close the parent's connection socket.
            config(['database.connections.racer' => config('database.connections.pgsql')]);
            DB::setDefaultConnection('racer');

            while (microtime(true) < $startAt) {
                usleep(200);
            }

            try {
                $result = $contender();
            } catch (CallConflictException $e) {
                $result = $e->errorCode;
            } catch (Throwable $e) {
                $result = 'error: '.$e->getMessage();
            }

            file_put_contents("{$resultDir}/{$index}.txt", $result);
            posix_kill(posix_getpid(), SIGKILL);
        }

        $pids[] = $pid;
    }

    foreach ($pids as $pid) {
        pcntl_waitpid($pid, $status);
    }

    return array_map(fn (int $index) => (string) @file_get_contents("{$resultDir}/{$index}.txt"), array_keys($contenders));
}

it('lets only one of two people who call each other at the same moment get through', function () {
    $a = racer($this);
    $b = racer($this);
    $chat = racingDirect($this, $a, $b);

    foreach (range(1, 3) as $round) {
        $results = race($this->resultDir, [
            fn () => callFrom($chat->id, $a->id, CallKind::Video),
            fn () => callFrom($chat->id, $b->id, CallKind::Video),
        ]);

        sort($results);
        expect($results)->toBe(['already_in_call', 'created'])
            ->and(Call::active()->involving($a)->count())->toBe(1);

        Call::query()->update(['status' => CallStatus::Ended->value, 'ended_at' => now()]); // next round
    }
});

it('rings a busy person only once when several people call them at the same moment', function () {
    $callee = racer($this);
    $callers = [racer($this), racer($this), racer($this), racer($this)];
    $chats = array_map(fn (User $caller) => racingDirect($this, $caller, $callee), $callers);

    $results = race($this->resultDir, array_map(
        fn (User $caller, Chat $chat) => fn () => callFrom($chat->id, $caller->id, CallKind::Voice),
        $callers,
        $chats,
    ));

    sort($results);
    expect($results)->toBe(['callee_busy', 'callee_busy', 'callee_busy', 'created'])
        ->and(Call::active()->involving($callee)->count())->toBe(1);
});

it('lets either the answer or the "no" win when both come at the same moment, never both', function () {
    $caller = racer($this);
    $callee = racer($this);
    $chat = racingDirect($this, $caller, $callee);
    $seen = [];

    foreach (range(1, 4) as $round) {
        $call = app(StartCall::class)->handle($chat, $caller, CallKind::Video);

        $results = race($this->resultDir, [
            fn () => 'accept:'.app(AcceptCall::class)->handle(Call::find($call->id))->status->value,
            fn () => 'decline:'.app(DeclineCall::class)->handle(Call::find($call->id))->status->value,
        ]);

        $final = $call->fresh()->status;
        $seen[] = $final->value;

        expect($final)->toBeIn([CallStatus::Ongoing, CallStatus::Declined])
            ->and($results)->toBe($final === CallStatus::Ongoing
                ? ['accept:ongoing', 'call_not_ringing']
                : ['call_not_ringing', 'decline:declined'])
            // Exactly one summary when declined, none while it is going on.
            ->and(Message::where('chat_id', $chat->id)->where('metadata->call_id', $call->id)->count())->toBe($final === CallStatus::Declined ? 1 : 0);

        Call::whereKey($call->id)->update(['status' => CallStatus::Ended->value, 'ended_at' => now()]); // next round
    }
});
