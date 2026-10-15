<?php

namespace App\Services;

use App\Enums\UserStatus;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * Who is online right now.
 *
 * "Online" means a cache key (Redis in production) written by the client's heartbeat is still alive.
 * The users.status column mirrors it for display and is corrected by presence:mark-offline when
 * keys expire.
 */
class PresenceService
{
    /**
     * Record a heartbeat: refresh the key and last_seen_at, and move an offline user to online.
     * A client may report a deliberate status (away / busy); otherwise the current one is kept.
     */
    public function heartbeat(User $user, ?UserStatus $reported = null): User
    {
        $status = $reported
            ?? ($user->status === UserStatus::Offline ? UserStatus::Online : $user->status);

        Cache::put($this->key($user->getKey()), now()->timestamp, config('chat.presence.ttl_seconds'));

        // Straight to the database: no model events and no updated_at churn for a 30-second ping.
        User::whereKey($user->getKey())->toBase()->update([
            'status' => $status->value,
            'last_seen_at' => now(),
        ]);

        $user->forceFill(['status' => $status, 'last_seen_at' => now()])->syncOriginal();

        return $user;
    }

    /**
     * Presence of the requested users, limited to people the viewer may see: themselves and
     * anyone they share a chat with. Other ids are left out, so this cannot be used to track
     * strangers or to find out whether an id exists.
     *
     * Each returned user has a `presence_status` attribute: their stored status if their heartbeat
     * is alive, otherwise offline (even if presence:mark-offline has not caught up yet).
     *
     * @param  list<string>  $ids
     * @return Collection<int, User>
     */
    public function visibleTo(User $viewer, array $ids): Collection
    {
        $users = User::query()
            ->whereIn('users.id', $ids)
            ->where(fn ($query) => $query
                ->where('users.id', $viewer->getKey())
                ->orWhereExists(fn ($shared) => $shared
                    ->selectRaw('1')
                    ->from('chat_members as theirs')
                    ->join('chat_members as mine', 'mine.chat_id', '=', 'theirs.chat_id')
                    ->whereColumn('theirs.user_id', 'users.id')
                    ->where('mine.user_id', $viewer->getKey())))
            ->get(['users.id', 'users.status', 'users.last_seen_at']);

        $alive = $this->alive($users->modelKeys());

        return $users->each(fn (User $user) => $user->setAttribute(
            'presence_status',
            $alive[$user->getKey()] ? $user->status : UserStatus::Offline,
        ));
    }

    /**
     * Which of these users have a live heartbeat right now.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    public function onlineAmong(array $ids): array
    {
        return array_keys(array_filter($this->alive($ids)));
    }

    /**
     * Mark users whose heartbeat has expired as offline. Returns how many were changed.
     */
    public function markStaleOffline(): int
    {
        $changed = 0;
        $cutoff = now()->subSeconds(config('chat.presence.ttl_seconds'));

        User::query()
            ->where('status', '!=', UserStatus::Offline->value)
            ->select('id')
            ->chunkById(500, function ($users) use (&$changed, $cutoff) {
                $alive = $this->alive($users->modelKeys());
                $stale = $users->filter(fn (User $user) => ! $alive[$user->getKey()])->modelKeys();

                // The last_seen_at check keeps a heartbeat that lands between the lookup and the
                // update from being overwritten.
                $changed += User::whereIn('id', $stale)
                    ->where(fn ($query) => $query->whereNull('last_seen_at')->orWhere('last_seen_at', '<', $cutoff))
                    ->update(['status' => UserStatus::Offline->value]);
            });

        return $changed;
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, bool> user id => has a live heartbeat
     */
    private function alive(array $ids): array
    {
        $found = Cache::many(array_map(fn (string $id) => $this->key($id), $ids));

        $alive = [];
        foreach ($ids as $id) {
            $alive[$id] = $found[$this->key($id)] !== null;
        }

        return $alive;
    }

    private function key(string $userId): string
    {
        return "presence:user:{$userId}";
    }
}
