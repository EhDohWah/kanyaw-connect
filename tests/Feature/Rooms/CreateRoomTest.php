<?php

use App\Enums\MessageType;
use App\Events\MessageSent;
use App\Models\Message;
use App\Models\Room;
use App\Models\User;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->livekit = fakeLiveKit();
    $this->me = signIn();
});

it('creates an instant room with the creator as host', function () {
    $response = $this->postJson('/api/v1/rooms', ['name' => 'Quick call'])
        ->assertCreated()
        ->assertJsonPath('data.name', 'Quick call')
        ->assertJsonPath('data.type', 'instant')
        ->assertJsonPath('data.status', 'waiting')
        ->assertJsonPath('data.host.id', $this->me->id)
        ->assertJsonPath('data.max_participants', 50)
        ->assertJsonPath('data.has_password', false)
        ->assertJsonPath('data.waiting_room_enabled', false)
        ->assertJsonPath('data.is_locked', false)
        ->assertJsonPath('data.recording_enabled', false)
        ->assertJsonPath('data.my_participation.role', 'host')
        ->assertJsonPath('data.my_participation.admission', 'admitted');

    $room = Room::findOrFail($response->json('data.id'));
    expect($room->id)->toBeUuid()
        ->and($room->host_id)->toBe($this->me->id)
        ->and($room->livekit_room_name)->toStartWith('kc-')
        ->and($room->participants()->count())->toBe(1);

    // The LiveKit room is only created when the first person gets a token.
    expect($this->livekit->created)->toBe([]);
});

it('never exposes the password or the LiveKit room name', function () {
    $response = $this->postJson('/api/v1/rooms', ['name' => 'Private', 'password' => 'open-sesame'])->assertCreated();

    $room = Room::find($response->json('data.id'));
    expect($response->json('data.has_password'))->toBeTrue()
        ->and($response->getContent())->not->toContain('open-sesame')->not->toContain($room->password)->not->toContain($room->livekit_room_name)
        ->and($room->password)->not->toBe('open-sesame')
        ->and(Hash::check('open-sesame', $room->password))->toBeTrue();
});

it('creates a scheduled room', function () {
    $at = now()->addDays(2)->startOfMinute();

    $this->postJson('/api/v1/rooms', [
        'name' => 'Monthly meeting',
        'description' => 'Agenda in the group',
        'scheduled_at' => $at->toIso8601String(),
        'duration_minutes' => 90,
        'waiting_room_enabled' => true,
        'max_participants' => 20,
    ])
        ->assertCreated()
        ->assertJsonPath('data.type', 'scheduled')
        ->assertJsonPath('data.duration_minutes', 90)
        ->assertJsonPath('data.waiting_room_enabled', true)
        ->assertJsonPath('data.max_participants', 20);

    expect(Room::first()->scheduled_at->eq($at))->toBeTrue();
});

it('validates the room input', function (array $payload, string $field) {
    $this->postJson('/api/v1/rooms', array_merge(['name' => 'Room'], $payload))
        ->assertUnprocessable()
        ->assertJsonValidationErrors($field);
})->with([
    'no name' => [['name' => ''], 'name'],
    'name too long' => [['name' => str_repeat('a', 121)], 'name'],
    'unknown type' => [['type' => 'weekly'], 'type'],
    'scheduled without a time' => [['type' => 'scheduled'], 'scheduled_at'],
    'scheduled in the past' => [['scheduled_at' => '2020-01-01 10:00:00'], 'scheduled_at'],
    'instant with a time' => [['type' => 'instant', 'scheduled_at' => '2099-01-01 10:00:00'], 'scheduled_at'],
    'duration too short' => [['duration_minutes' => 4], 'duration_minutes'],
    'duration too long' => [['duration_minutes' => 1441], 'duration_minutes'],
    'one participant' => [['max_participants' => 1], 'max_participants'],
    'over 100 participants' => [['max_participants' => 101], 'max_participants'],
    'short password' => [['password' => 'abc'], 'password'],
    'chat id not a uuid' => [['chat_id' => 'nope'], 'chat_id'],
]);

it('accepts exactly 100 participants', function () {
    $this->postJson('/api/v1/rooms', ['name' => 'Big', 'max_participants' => 100])->assertCreated()->assertJsonPath('data.max_participants', 100);
});

it('ignores fields clients must not set', function () {
    $other = User::factory()->create();

    $id = $this->postJson('/api/v1/rooms', [
        'name' => 'Room', 'host_id' => $other->id, 'status' => 'active', 'is_locked' => true,
        'recording_enabled' => true, 'livekit_room_name' => 'mine',
    ])->assertCreated()->json('data.id');

    $room = Room::find($id);
    expect($room->host_id)->toBe($this->me->id)
        ->and($room->status->value)->toBe('waiting')
        ->and($room->is_locked)->toBeFalse()
        ->and($room->recording_enabled)->toBeFalse()
        ->and($room->livekit_room_name)->not->toBe('mine');
});

describe('linked to a chat', function () {
    it('posts a system message into the chat and broadcasts it', function () {
        fakeBroadcasts();
        $chat = makeGroup($this->me, [User::factory()->create(), User::factory()->create()]);

        $roomId = $this->postJson('/api/v1/rooms', ['name' => 'Standup', 'chat_id' => $chat->id])
            ->assertCreated()
            ->assertJsonPath('data.chat_id', $chat->id)
            ->json('data.id');

        $message = Message::where('chat_id', $chat->id)->sole();
        expect($message->type)->toBe(MessageType::System)
            ->and($message->sender_id)->toBeNull()
            ->and($message->content)->toBe("{$this->me->name} started a video room: Standup")
            ->and($message->metadata)->toEqualCanonicalizing(['event' => 'room_created', 'room_id' => $roomId, 'host_id' => $this->me->id])
            ->and($chat->fresh()->last_message_at->gte($message->created_at))->toBeTrue();

        Event::assertDispatched(MessageSent::class, fn (MessageSent $e) => payloadOf($e)['message']['id'] === $message->id
            && payloadOf($e)['message']['type'] === 'system'
            && payloadOf($e)['message']['sender'] === null);
    });

    it('says "scheduled" for a scheduled room', function () {
        $chat = makeGroup($this->me);

        $this->postJson('/api/v1/rooms', ['name' => 'Later', 'chat_id' => $chat->id, 'scheduled_at' => now()->addDay()->toIso8601String()])->assertCreated();

        expect(Message::where('chat_id', $chat->id)->sole()->content)->toContain('scheduled a video room: Later');
    });

    it('works from a direct chat too', function () {
        $chat = makeDirect($this->me, User::factory()->create());

        $this->postJson('/api/v1/rooms', ['name' => 'Call', 'chat_id' => $chat->id])->assertCreated();
    });

    it('does not count the announcement as unread', function () {
        $friend = User::factory()->create();
        $chat = makeGroup($this->me, [$friend]);
        $this->postJson('/api/v1/rooms', ['name' => 'Call', 'chat_id' => $chat->id])->assertCreated();

        expect($chat->unreadCountFor($friend))->toBe(0);
    });

    it('refuses a chat the user is not in, and one that does not exist, with the same 403', function () {
        $someoneElses = makeGroup(User::factory()->create());

        $this->postJson('/api/v1/rooms', ['name' => 'Sneaky', 'chat_id' => $someoneElses->id])->assertForbidden();
        $this->postJson('/api/v1/rooms', ['name' => 'Ghost', 'chat_id' => (string) Str::uuid()])->assertForbidden();

        expect(Room::count())->toBe(0)->and(Message::count())->toBe(0);
    });

    it('refuses a user who has left the chat', function () {
        $chat = makeGroup(User::factory()->create(), [$this->me]);
        $chat->chatMembers()->where('user_id', $this->me->id)->delete();

        $this->postJson('/api/v1/rooms', ['name' => 'Call', 'chat_id' => $chat->id])->assertForbidden();
    });
});

it('requires authentication', function () {
    $this->app['auth']->forgetGuards();
    $this->withHeader('Authorization', '')->postJson('/api/v1/rooms', ['name' => 'x'])->assertUnauthorized();
});
