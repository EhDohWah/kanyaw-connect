<?php

namespace Tests\Support;

use App\Exceptions\LiveKitException;
use App\Models\Room;
use App\Models\User;
use App\Services\LiveKitService;

/**
 * Stands in for LiveKit in tests: no network. Records what the app asked for. Token signing and
 * webhook verification are NOT faked (they are pure computation), so tests exercise the real code.
 */
class FakeLiveKitService extends LiveKitService
{
    /** @var list<string> LiveKit room names created */
    public array $created = [];

    /** @var list<string> LiveKit room names deleted */
    public array $deleted = [];

    /** @var list<array{room: string, user: string}> */
    public array $removed = [];

    /** @var list<array{room: string, user: string, kind: string}> */
    public array $muted = [];

    /** @var array<string, int> user id => number of unmuted tracks of any kind, for people "connected" in LiveKit */
    public array $connected = [];

    /** Make every network call fail, as if LiveKit were down. */
    public bool $down = false;

    public function __construct()
    {
        parent::__construct(config('services.livekit'));
    }

    public function createRoom(Room $room): void
    {
        $this->guard();
        $this->created[] = $room->livekit_room_name;
    }

    public function deleteRoom(Room $room): void
    {
        $this->guard();
        $this->deleted[] = $room->livekit_room_name;
    }

    public function listParticipants(Room $room): array
    {
        $this->guard();

        return array_map(
            fn (string $id) => ['identity' => $id, 'name' => '', 'tracks' => []],
            array_keys($this->connected),
        );
    }

    public function removeParticipant(Room $room, User|string $user): bool
    {
        $this->guard();
        $id = $user instanceof User ? $user->getKey() : $user;
        $this->removed[] = ['room' => $room->livekit_room_name, 'user' => $id];

        return true;
    }

    public function muteTrack(Room $room, User|string $user, string $kind = 'audio'): ?int
    {
        $this->guard();
        $id = $user instanceof User ? $user->getKey() : $user;

        if (! array_key_exists($id, $this->connected)) {
            return null;
        }

        $this->muted[] = ['room' => $room->livekit_room_name, 'user' => $id, 'kind' => $kind];

        return $this->connected[$id];
    }

    private function guard(): void
    {
        if ($this->down) {
            throw LiveKitException::from(new \RuntimeException('LiveKit is down'));
        }
    }
}
