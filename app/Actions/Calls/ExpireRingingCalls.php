<?php

namespace App\Actions\Calls;

use App\Enums\CallEndReason;
use App\Enums\CallStatus;
use App\Models\Call;
use Illuminate\Database\Eloquent\Builder;

class ExpireRingingCalls
{
    public function __construct(private FinishCall $finish) {}

    /**
     * Mark calls that are still ringing after ring_expires_at as missed (no_answer). The delayed
     * ExpireRingingCall job normally does this on time; this catches the ones it has not done yet
     * (a busy or stopped queue worker).
     *
     * @param  list<string|null>|null  $userIds  only calls involving these people; null for all
     * @return int how many were marked missed now
     */
    public function handle(?array $userIds = null): int
    {
        $userIds = $userIds === null ? null : array_values(array_filter($userIds));

        $overdue = Call::query()
            ->where('status', CallStatus::Ringing->value)
            ->where('ring_expires_at', '<=', Call::microseconds(now()))
            ->when($userIds !== null, fn (Builder $query) => $query->where(fn (Builder $q) => $q
                ->whereIn('caller_id', $userIds)
                ->orWhereIn('callee_id', $userIds)))
            ->get();

        return $overdue->filter(fn (Call $call) => $this->finish->handle($call, CallStatus::Missed, CallEndReason::NoAnswer, [CallStatus::Ringing]))->count();
    }
}
