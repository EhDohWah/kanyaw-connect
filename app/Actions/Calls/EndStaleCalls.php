<?php

namespace App\Actions\Calls;

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Enums\RoomStatus;
use App\Models\Call;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * The backstop for calls, run with the stale-room cleanup (rooms:end-stale). The ringing timeout
 * job, the LiveKit webhooks and the reconnect grace normally settle every call; this catches the
 * ones they missed because the queue worker or the API was down.
 */
class EndStaleCalls
{
    public function __construct(private ExpireRingingCalls $expire, private FinishCall $finish) {}

    /**
     * @return array{missed: int, lost: int}
     */
    public function handle(): array
    {
        $result = ['missed' => $this->expire->handle(), 'lost' => 0];

        $this->lostConnection()->chunkById(config('cleanup.chunk_size'), function (Collection $calls) use (&$result) {
            foreach ($calls as $call) {
                // Look again right before ending: the person may have come back since the list was read.
                if ($this->lostConnection()->whereKey($call->getKey())->exists()
                    && $this->finish->handle($call, CallStatus::Ended, CallEndReason::ConnectionLost, [CallStatus::Ongoing])) {
                    $result['lost']++;
                }
            }
        });

        return $result;
    }

    /**
     * Answered calls that cannot really be going on: the room has ended, one of the two has been
     * gone for longer than the reconnect grace (or never connected at all since it was answered),
     * or it has lasted longer than any room may.
     *
     * @return Builder<Call>
     */
    private function lostConnection(): Builder
    {
        $graceCutoff = Call::microseconds(now()->subSeconds(config('calls.reconnect_grace_seconds')));
        // Connecting can take a while on a slow phone: allow as long as a join token holds a seat.
        $connectCutoff = Call::microseconds(now()->subSeconds(max(config('calls.reconnect_grace_seconds'), config('rooms.seat_hold_seconds'))));
        $tooLong = Call::microseconds(now()->subHours(config('cleanup.stale_rooms.max_active_hours')));

        return Call::query()
            ->where('calls.status', CallStatus::Ongoing->value)
            ->where(fn (Builder $query) => $query
                ->whereRaw('exists (select 1 from rooms r where r.id = calls.room_id and r.status = ?)', [RoomStatus::Ended->value])
                ->orWhereRaw(
                    'exists (select 1 from room_participants p where p.room_id = calls.room_id and p.user_id in (calls.caller_id, calls.callee_id) and (
                        (p.left_at is not null and greatest(p.left_at, calls.answered_at) < ?)
                        or (p.joined_at is null and calls.answered_at < ?)
                    ))',
                    [$graceCutoff, $connectCutoff],
                )
                ->orWhere('calls.answered_at', '<', $tooLong));
    }
}
