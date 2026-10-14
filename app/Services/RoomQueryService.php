<?php

namespace App\Services;

use App\Enums\RoomAdmission;
use App\Enums\RoomStatus;
use App\Models\Room;
use App\Models\RoomParticipant;
use App\Models\User;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;

/**
 * Loads rooms the way the API shows them to one user, in a fixed number of queries.
 */
class RoomQueryService
{
    /**
     * The user's rooms that have not ended: ones they host, are invited to through a chat, or have
     * asked to join.
     *
     * filter=hosting   only rooms they host
     * filter=invited   only rooms hosted by someone else
     * filter=upcoming  scheduled rooms still to come (soonest first)
     */
    public function paginate(User $user, ?string $filter, int $perPage): CursorPaginator
    {
        $query = $this->base()
            ->visibleTo($user)
            ->where('rooms.status', '!=', RoomStatus::Ended->value);

        match ($filter) {
            'hosting' => $query->where('rooms.host_id', $user->getKey()),
            'invited' => $query->where('rooms.host_id', '!=', $user->getKey()),
            'upcoming' => $query->whereNotNull('rooms.scheduled_at')->where('rooms.scheduled_at', '>', Room::microseconds(now())),
            default => null,
        };

        $filter === 'upcoming'
            ? $query->orderBy('rooms.scheduled_at')->orderBy('rooms.id')
            : $query->orderByDesc('rooms.created_at')->orderByDesc('rooms.id');

        $page = $query->cursorPaginate($perPage)->withQueryString();

        $this->hydrate($page->getCollection(), $user);

        return $page;
    }

    /** One room, with the waiting list added if the user can manage it. */
    public function find(User $user, Room $room): Room
    {
        $found = $this->base()->whereKey($room->getKey())->firstOrFail();

        $this->hydrate(new Collection([$found]), $user);

        if ($found->isManagedBy($user)) {
            $found->load(['waitingParticipants' => fn ($q) => $q->with('user')]);
        }

        return $found;
    }

    private function base(): Builder
    {
        return Room::query()
            ->select('rooms.*')
            ->addSelect(['present_count' => RoomParticipant::query()
                ->selectRaw('count(*)')
                ->whereColumn('room_participants.room_id', 'rooms.id')
                ->whereNotNull('joined_at')
                ->whereNull('left_at')
                ->where('admission', RoomAdmission::Admitted->value),
            ]);
    }

    /**
     * @param  Collection<int, Room>  $rooms
     */
    private function hydrate(Collection $rooms, User $user): void
    {
        if ($rooms->isEmpty()) {
            return;
        }

        $rooms->load('host');

        $mine = RoomParticipant::query()
            ->where('user_id', $user->getKey())
            ->whereIn('room_id', $rooms->modelKeys())
            ->get()
            ->keyBy('room_id');

        foreach ($rooms as $room) {
            $room->setRelation('myParticipant', $mine->get($room->getKey()));
        }
    }
}
