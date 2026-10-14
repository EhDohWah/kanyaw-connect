<?php

use App\Enums\RoomAdmission;
use App\Models\User;

beforeEach(function () {
    fakeLiveKit();
    $this->me = signIn();
});

function roomIds($test, string $query = ''): array
{
    return collect($test->getJson('/api/v1/rooms'.$query)->assertOk()->json('data'))->pluck('id')->all();
}

it('lists rooms I host, rooms in my chats, and rooms I asked to join', function () {
    $other = User::factory()->create();
    $chat = makeGroup($other, [$this->me]);

    $hosting = makeRoom($this->me);
    $viaChat = makeRoom($other, ['chat_id' => $chat->id]);
    $viaRow = makeRoom($other);
    addParticipant($viaRow, $this->me, ['admission' => RoomAdmission::Waiting]);

    $strangers = makeRoom($other);
    $strangersChat = makeRoom($other, ['chat_id' => makeGroup($other)->id]);

    expect(roomIds($this))->toEqualCanonicalizing([$hosting->id, $viaChat->id, $viaRow->id])
        ->not->toContain($strangers->id, $strangersChat->id);
});

it('hides ended rooms', function () {
    $live = makeRoom($this->me);
    makeRoom($this->me, ['status' => 'ended', 'ended_at' => now()]);

    expect(roomIds($this))->toBe([$live->id]);
});

it('hides rooms of chats I have left', function () {
    $other = User::factory()->create();
    $chat = makeGroup($other, [$this->me]);
    $room = makeRoom($other, ['chat_id' => $chat->id]);
    expect(roomIds($this))->toBe([$room->id]);

    $chat->chatMembers()->where('user_id', $this->me->id)->delete();
    expect(roomIds($this))->toBe([]);
});

describe('filters', function () {
    it('hosting: only my own rooms', function () {
        $other = User::factory()->create();
        $mine = makeRoom($this->me);
        makeRoom($other, ['chat_id' => makeGroup($other, [$this->me])->id]);

        expect(roomIds($this, '?filter=hosting'))->toBe([$mine->id]);
    });

    it('invited: only rooms hosted by someone else', function () {
        $other = User::factory()->create();
        makeRoom($this->me);
        $invited = makeRoom($other, ['chat_id' => makeGroup($other, [$this->me])->id]);

        expect(roomIds($this, '?filter=invited'))->toBe([$invited->id]);
    });

    it('upcoming: scheduled rooms still to come, soonest first', function () {
        $later = makeRoom($this->me, ['type' => 'scheduled', 'scheduled_at' => now()->addDays(3)]);
        $soon = makeRoom($this->me, ['type' => 'scheduled', 'scheduled_at' => now()->addHour()]);
        makeRoom($this->me, ['type' => 'scheduled', 'scheduled_at' => now()->subHour()]); // already past
        makeRoom($this->me); // instant

        expect(roomIds($this, '?filter=upcoming'))->toBe([$soon->id, $later->id]);
    });

    it('rejects an unknown filter', function () {
        $this->getJson('/api/v1/rooms?filter=everything')->assertUnprocessable()->assertJsonValidationErrors('filter');
    });
});

it('lists newest first and pages with cursors without gaps or repeats', function () {
    $expected = collect(range(1, 7))->map(fn ($i) => makeRoom($this->me, ['created_at' => now()->subMinutes($i)])->id);

    $seen = collect();
    $url = '/api/v1/rooms?per_page=3';
    do {
        $page = $this->getJson($url)->assertOk();
        expect(count($page->json('data')))->toBeLessThanOrEqual(3);
        $seen = $seen->merge(collect($page->json('data'))->pluck('id'));
        $url = $page->json('links.next');
    } while ($url);

    expect($seen->all())->toBe($expected->all());
});

it('pages upcoming rooms in scheduled order', function () {
    $expected = collect(range(1, 5))->map(fn ($i) => makeRoom($this->me, ['type' => 'scheduled', 'scheduled_at' => now()->addHours($i)])->id);

    $seen = collect();
    $url = '/api/v1/rooms?filter=upcoming&per_page=2';
    do {
        $page = $this->getJson($url)->assertOk();
        $seen = $seen->merge(collect($page->json('data'))->pluck('id'));
        $url = $page->json('links.next');
    } while ($url);

    expect($seen->all())->toBe($expected->all());
});

it('shows my standing and who is connected in each room', function () {
    $other = User::factory()->create();
    $room = makeRoom($other);
    addParticipant($room, $this->me, ['admission' => RoomAdmission::Waiting]);
    addParticipant($room, null, ['joined_at' => now()->subMinute()]);

    $row = $this->getJson('/api/v1/rooms')->json('data.0');

    expect($row['my_participation'])->toBe(['role' => 'participant', 'admission' => 'waiting'])
        ->and($row['present_count'])->toBe(1)
        ->and($row['host']['id'])->toBe($other->id)
        ->and($row)->not->toHaveKey('waiting_participants');
});

it('uses the same number of queries for 2 rooms and for 25', function () {
    $seed = function (int $n) {
        foreach (range(1, $n) as $_) {
            $host = User::factory()->create();
            $room = makeRoom($host, ['chat_id' => makeGroup($host, [$this->me])->id]);
            addParticipant($room, null, ['joined_at' => now()]);
            addParticipant($room, $this->me);
        }
    };

    $seed(2);
    $few = countQueries(fn () => $this->getJson('/api/v1/rooms')->assertOk());

    $seed(23);
    $many = countQueries(fn () => $this->getJson('/api/v1/rooms?per_page=100')->assertOk()->assertJsonCount(25, 'data'));

    expect($many)->toBe($few);
});

it('does not expose passwords, LiveKit names or hosts\' contact details', function () {
    $other = User::factory()->create(['phone' => '+66844444444']);
    $room = makeRoom($other, ['password' => 'hidden-pass', 'chat_id' => makeGroup($other, [$this->me])->id]);

    $content = $this->getJson('/api/v1/rooms')->getContent();

    expect($content)->not->toContain('hidden-pass')->not->toContain($room->livekit_room_name)
        ->not->toContain($other->email)->not->toContain('+66844444444');
});

it('requires authentication', function () {
    $this->app['auth']->forgetGuards();
    $this->withHeader('Authorization', '')->getJson('/api/v1/rooms')->assertUnauthorized();
});
