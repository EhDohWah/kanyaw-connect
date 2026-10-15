<?php

use App\Models\Device;
use App\Models\OneTimePrekey;
use App\Models\User;
use App\Services\KeyBundleService;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

/*
| Real concurrency: separate PHP processes, each with its own database connection, ask for the same
| device's key bundle at the same instant. A one-time prekey must go to exactly one of them.
|
| This cannot be a normal Feature test: those run inside one database transaction on one connection,
| so two "simultaneous" requests would just take turns. Here the data is committed and cleaned up
| by the test itself.
*/

beforeEach(function () {
    if (! function_exists('pcntl_fork')) {
        $this->markTestSkipped('pcntl is required to fork competing processes.');
    }

    Artisan::call('migrate', ['--force' => true]);

    $this->owner = User::factory()->create();
    $this->device = Device::factory()->withPrekeys(3)->create(['user_id' => $this->owner->id]);
    $this->resultDir = sys_get_temp_dir().'/prekey-race-'.bin2hex(random_bytes(4));
    mkdir($this->resultDir);
});

afterEach(function () {
    if (isset($this->owner)) {
        User::withTrashed()->whereKey($this->owner->id)->forceDelete(); // cascades to devices and prekeys
    }
    if (isset($this->resultDir)) {
        array_map('unlink', glob($this->resultDir.'/*') ?: []);
        @rmdir($this->resultDir);
    }
});

/**
 * Run $workers processes at once; each claims the bundle for $target and writes the prekey id it got.
 *
 * @return list<int|null> the key id each worker received (null = none left)
 */
function raceForBundle(User $target, string $resultDir, int $workers): array
{
    $startAt = microtime(true) + 0.6; // everyone fires at the same instant
    $pids = [];

    foreach (range(1, $workers) as $worker) {
        $pid = pcntl_fork();

        if ($pid === 0) {
            // CHILD. Use a brand new connection: the inherited one belongs to the parent. The child
            // ends with SIGKILL so no destructor can close the parent's connection socket.
            config(['database.connections.racer' => config('database.connections.pgsql')]);
            DB::setDefaultConnection('racer');

            while (microtime(true) < $startAt) {
                usleep(200);
            }

            $result = null;
            try {
                $devices = app(KeyBundleService::class)->claimFor($target);
                $result = $devices->first()?->claimedPrekey?->key_id;
            } catch (Throwable $e) {
                file_put_contents("{$resultDir}/error-{$worker}.txt", $e->getMessage());
            }

            file_put_contents("{$resultDir}/{$worker}.json", json_encode($result));
            posix_kill(posix_getpid(), SIGKILL);
        }

        $pids[] = $pid;
    }

    foreach ($pids as $pid) {
        pcntl_waitpid($pid, $status);
    }

    expect(glob("{$resultDir}/error-*.txt"))->toBe([]);

    return array_map(fn (int $worker) => json_decode(file_get_contents("{$resultDir}/{$worker}.json")), range(1, $workers));
}

it('gives each one-time prekey to exactly one of many simultaneous requests', function () {
    $results = raceForBundle($this->owner, $this->resultDir, 8);

    $received = array_values(array_filter($results, fn ($id) => $id !== null));

    // 3 prekeys, 8 competitors: 3 distinct winners and 5 who get no one-time prekey.
    expect($received)->toHaveCount(3)
        ->and(array_unique($received))->toHaveCount(3)
        ->and(count(array_filter($results, fn ($id) => $id === null)))->toBe(5);

    $claimed = OneTimePrekey::where('device_id', $this->device->id)->whereNotNull('claimed_at')->pluck('key_id')->sort()->values()->all();
    expect($claimed)->toBe([1, 2, 3]);
});

it('never hands the same prekey out twice, across many rounds', function () {
    // 12 prekeys, claimed by 4 processes per round for 3 rounds: 12 distinct prekeys in total.
    $this->device->oneTimePrekeys()->delete();
    foreach (range(1, 12) as $keyId) {
        OneTimePrekey::create(['device_id' => $this->device->id, 'key_id' => $keyId, 'public_key' => base64_encode(random_bytes(32)), 'created_at' => now()]);
    }

    $all = [];
    foreach (range(1, 3) as $_) {
        $all = [...$all, ...raceForBundle($this->owner, $this->resultDir, 4)];
    }

    expect(array_filter($all, fn ($id) => $id === null))->toBe([])
        ->and(array_unique($all))->toHaveCount(12);
});
