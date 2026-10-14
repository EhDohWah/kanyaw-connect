<?php

namespace App\Services;

use Agence104\LiveKit\AccessToken;
use Agence104\LiveKit\AccessTokenOptions;
use Agence104\LiveKit\RoomCreateOptions;
use Agence104\LiveKit\RoomServiceClient;
use Agence104\LiveKit\VideoGrant;
use Agence104\LiveKit\WebhookReceiver;
use App\Enums\RoomRole;
use App\Exceptions\LiveKitException;
use App\Models\Room;
use App\Models\User;
use Livekit\TrackType;
use Livekit\WebhookEvent;
use Throwable;
use Twirp\Error as TwirpError;

/**
 * Everything the app needs from LiveKit. LiveKit itself handles all WebRTC signalling, SDP and
 * ICE: this class only creates rooms, signs join tokens and issues host commands.
 *
 * Tests bind a fake subclass in the container that overrides the methods which call the network.
 */
class LiveKitService
{
    private ?RoomServiceClient $client = null;

    /**
     * @param  array{url: string, host: string, api_key: ?string, api_secret: ?string, token_ttl: int}  $config
     */
    public function __construct(private readonly array $config) {}

    /** The websocket address clients connect to. */
    public function clientUrl(): string
    {
        return $this->config['url'];
    }

    /**
     * Create the LiveKit room, applying our participant limit. Safe to call again for a room that
     * already exists (LiveKit returns the existing one).
     */
    public function createRoom(Room $room): void
    {
        $this->call(fn () => $this->client()->createRoom(
            (new RoomCreateOptions)
                ->setName($room->livekit_room_name)
                ->setEmptyTimeout(config('rooms.livekit_empty_timeout_seconds'))
                ->setMaxParticipants($room->max_participants)
        ));
    }

    /** Close the LiveKit room and disconnect everyone. A room that is already gone is fine. */
    public function deleteRoom(Room $room): void
    {
        $this->call(fn () => $this->client()->deleteRoom($room->livekit_room_name), ignoreNotFound: true);
    }

    /**
     * A signed token that lets $user join $room's LiveKit room.
     *
     * Identity is the user's UUID, so webhooks map straight back to users. Hosts and co-hosts get
     * roomAdmin. Pure computation: no network call.
     */
    public function generateToken(User $user, Room $room, RoomRole $role): string
    {
        $grant = (new VideoGrant)
            ->setRoomJoin()
            ->setRoomName($room->livekit_room_name)
            ->setCanPublish()
            ->setCanSubscribe()
            ->setCanPublishData();

        if ($role === RoomRole::Host || $role === RoomRole::CoHost) {
            $grant->setRoomAdmin();
        }

        $options = (new AccessTokenOptions)
            ->setIdentity($user->getKey())
            ->setName($user->name)
            ->setTtl($this->config['token_ttl'])
            ->setMetadata(json_encode(['role' => $role->value, 'avatar_url' => $user->avatar_thumb_url]));

        return (new AccessToken($this->config['api_key'], $this->config['api_secret']))
            ->init($options)
            ->setGrant($grant)
            ->toJwt();
    }

    /**
     * Who is connected to the room right now, according to LiveKit.
     *
     * @return list<array{identity: string, name: string, tracks: list<array{sid: string, type: string, muted: bool}>}>
     */
    public function listParticipants(Room $room): array
    {
        $response = $this->call(fn () => $this->client()->listParticipants($room->livekit_room_name), ignoreNotFound: true);

        $participants = [];
        foreach ($response?->getParticipants() ?? [] as $participant) {
            $participants[] = [
                'identity' => $participant->getIdentity(),
                'name' => $participant->getName(),
                'tracks' => $this->tracksOf($participant),
            ];
        }

        return $participants;
    }

    /** Disconnect one user from the call. Returns false if they were not connected. */
    public function removeParticipant(Room $room, User|string $user): bool
    {
        $identity = $user instanceof User ? $user->getKey() : $user;

        return $this->call(
            fn () => $this->client()->removeParticipant($room->livekit_room_name, $identity),
            ignoreNotFound: true,
        ) !== null;
    }

    /**
     * Mute a participant's published tracks of one kind ('audio' or 'video'). LiveKit only lets the
     * server mute, never unmute: the person unmutes themselves. Returns how many tracks were muted,
     * or null if they are not connected.
     */
    public function muteTrack(Room $room, User|string $user, string $kind = 'audio'): ?int
    {
        $identity = $user instanceof User ? $user->getKey() : $user;

        $participant = $this->call(
            fn () => $this->client()->getParticipant($room->livekit_room_name, $identity),
            ignoreNotFound: true,
        );

        if ($participant === null) {
            return null;
        }

        $muted = 0;
        foreach ($this->tracksOf($participant) as $track) {
            if ($track['type'] === $kind && ! $track['muted']) {
                $this->call(fn () => $this->client()->mutePublishedTrack($room->livekit_room_name, $identity, $track['sid'], true));
                $muted++;
            }
        }

        return $muted;
    }

    /**
     * Verify a webhook request really came from our LiveKit server and parse it.
     *
     * @throws Throwable when the signature, expiry or body checksum is wrong
     */
    public function receiveWebhook(string $body, ?string $authorization): WebhookEvent
    {
        // LiveKit sends the bare JWT; tolerate a "Bearer " prefix from proxies.
        $token = $authorization !== null ? preg_replace('/^Bearer\s+/i', '', trim($authorization)) : null;

        return (new WebhookReceiver($this->config['api_key'], $this->config['api_secret']))->receive($body, $token);
    }

    /**
     * @return list<array{sid: string, type: string, muted: bool}>
     */
    private function tracksOf($participant): array
    {
        $tracks = [];
        foreach ($participant->getTracks() as $track) {
            $tracks[] = [
                'sid' => $track->getSid(),
                'type' => match ($track->getType()) {
                    TrackType::AUDIO => 'audio',
                    TrackType::VIDEO => 'video',
                    default => 'data',
                },
                'muted' => $track->getMuted(),
            ];
        }

        return $tracks;
    }

    private function client(): RoomServiceClient
    {
        return $this->client ??= new RoomServiceClient($this->config['host'], $this->config['api_key'], $this->config['api_secret']);
    }

    /**
     * Run a LiveKit call, turning transport/server failures into LiveKitException.
     * With $ignoreNotFound, "that room/participant does not exist" returns null instead of failing.
     */
    private function call(callable $callback, bool $ignoreNotFound = false): mixed
    {
        try {
            return $callback();
        } catch (Throwable $e) {
            if ($ignoreNotFound && $e instanceof TwirpError && $e->getErrorCode() === 'not_found') {
                return null;
            }

            report($e);

            throw LiveKitException::from($e);
        }
    }
}
