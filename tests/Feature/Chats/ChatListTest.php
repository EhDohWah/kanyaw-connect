<?php

use App\Models\User;

it('lists only the chats the user belongs to', function () {
    $me = signIn();
    $friend = User::factory()->create();
    $stranger = User::factory()->create();

    $mine = makeDirect($me, $friend);
    $group = makeGroup($friend, [$me]);
    makeDirect($friend, $stranger);
    makeGroup($stranger, [$friend]);

    $ids = collect($this->getJson('/api/v1/chats')->assertOk()->json('data'))->pluck('id');

    expect($ids)->toHaveCount(2)->toContain($mine->id, $group->id);
});

it('returns the latest message, unread count, other user and own membership', function () {
    $me = signIn();
    $friend = User::factory()->create(['name' => 'Naw Paw']);
    $chat = makeDirect($me, $friend);

    addMessage($chat, $friend, ['content' => 'first', 'created_at' => now()->subMinutes(3)]);
    addMessage($chat, $friend, ['content' => 'second', 'created_at' => now()->subMinutes(2)]);
    addMessage($chat, $me, ['content' => 'latest from me', 'created_at' => now()->subMinute()]);

    $row = $this->getJson('/api/v1/chats')->json('data.0');

    expect($row['latest_message']['content'])->toBe('latest from me')
        ->and($row['latest_message']['sender']['id'])->toBe($me->id)
        ->and($row['unread_count'])->toBe(2)
        ->and($row['other_user']['name'])->toBe('Naw Paw')
        ->and($row['my_membership']['role'])->toBe('member')
        ->and($row['type'])->toBe('direct');
});

it('has no latest message for an empty chat', function () {
    $me = signIn();
    makeDirect($me, User::factory()->create());

    $this->getJson('/api/v1/chats')
        ->assertOk()
        ->assertJsonPath('data.0.latest_message', null)
        ->assertJsonPath('data.0.unread_count', 0);
});

it('does not give a group chat an other_user', function () {
    $me = signIn();
    makeGroup($me, [User::factory()->create()]);

    $this->getJson('/api/v1/chats')->assertJsonMissingPath('data.0.other_user');
});

describe('unread count', function () {
    it('ignores own messages, system messages and deleted messages', function () {
        $me = signIn();
        $friend = User::factory()->create();
        $chat = makeDirect($me, $friend);

        addMessage($chat, $friend, ['created_at' => now()->subMinutes(5)]);
        addMessage($chat, $me, ['created_at' => now()->subMinutes(4)]);
        addMessage($chat, null, ['type' => 'system', 'content' => 'x joined', 'created_at' => now()->subMinutes(3)]);
        $deleted = addMessage($chat, $friend, ['created_at' => now()->subMinutes(2)]);
        $deleted->delete();

        $this->getJson('/api/v1/chats')->assertJsonPath('data.0.unread_count', 1);
        expect($chat->unreadCountFor($me))->toBe(1);
    });

    it('only counts messages after the last read position', function () {
        $me = signIn();
        $friend = User::factory()->create();
        $chat = makeDirect($me, $friend);
        $old = addMessage($chat, $friend, ['created_at' => now()->subMinutes(10)]);
        addMessage($chat, $friend, ['created_at' => now()->subMinutes(5)]);

        $chat->chatMembers()->where('user_id', $me->id)->update(['last_read_at' => ts($old->created_at)]);

        $this->getJson('/api/v1/chats')->assertJsonPath('data.0.unread_count', 1);
        expect($chat->unreadCountFor($me))->toBe(1);
    });

    it('counts every incoming message when nothing has been read yet', function () {
        $me = signIn();
        $friend = User::factory()->create();
        $chat = makeDirect($me, $friend);
        $chat->chatMembers()->where('user_id', $me->id)->update(['last_read_at' => null]);
        addMessage($chat, $friend);
        addMessage($chat, $friend);

        $this->getJson('/api/v1/chats')->assertJsonPath('data.0.unread_count', 2);
    });

    it('distinguishes messages sent within the same second', function () {
        $me = signIn();
        $friend = User::factory()->create();
        $chat = makeDirect($me, $friend);
        $base = now()->startOfSecond();

        $first = addMessage($chat, $friend, ['created_at' => $base->copy()->addMicroseconds(100)]);
        addMessage($chat, $friend, ['created_at' => $base->copy()->addMicroseconds(200)]);
        $chat->chatMembers()->where('user_id', $me->id)->update(['last_read_at' => ts($first->fresh()->created_at)]);

        $this->getJson('/api/v1/chats')->assertJsonPath('data.0.unread_count', 1);
    });

    it('is zero for non-members', function () {
        $chat = makeDirect(User::factory()->create(), User::factory()->create());

        expect($chat->unreadCountFor(User::factory()->create()))->toBe(0);
    });
});

it('orders chats by most recent activity', function () {
    $me = signIn();
    $old = makeGroup($me, [], [], ['last_message_at' => now()->subDays(2)]);
    $new = makeGroup($me, [], [], ['last_message_at' => now()->subMinute()]);
    $mid = makeGroup($me, [], [], ['last_message_at' => now()->subDay()]);

    $ids = collect($this->getJson('/api/v1/chats')->json('data'))->pluck('id')->all();

    expect($ids)->toBe([$new->id, $mid->id, $old->id]);
});

it('pages through all chats with cursors without gaps or repeats', function () {
    $me = signIn();
    $expected = collect(range(1, 7))->map(
        fn ($i) => makeGroup($me, [], [], ['last_message_at' => now()->subMinutes($i)])->id
    );

    $seen = collect();
    $url = '/api/v1/chats?per_page=3';

    do {
        $page = $this->getJson($url)->assertOk();
        expect(count($page->json('data')))->toBeLessThanOrEqual(3);
        $seen = $seen->merge(collect($page->json('data'))->pluck('id'));
        $url = $page->json('links.next');
    } while ($url);

    expect($seen->all())->toBe($expected->all());
});

it('keeps paging correctly when many chats share a timestamp', function () {
    $me = signIn();
    $at = now()->subHour();
    $ids = collect(range(1, 5))->map(fn () => makeGroup($me, [], [], ['last_message_at' => $at])->id);

    $seen = collect();
    $url = '/api/v1/chats?per_page=2';
    do {
        $page = $this->getJson($url)->assertOk();
        $seen = $seen->merge(collect($page->json('data'))->pluck('id'));
        $url = $page->json('links.next');
    } while ($url);

    expect($seen)->toHaveCount(5)->and($seen->unique())->toHaveCount(5)->and($seen->sort()->values()->all())->toBe($ids->sort()->values()->all());
});

it('clamps per_page to the maximum', function () {
    $me = signIn();
    makeGroup($me);

    $this->getJson('/api/v1/chats?per_page=5000')->assertOk()->assertJsonPath('meta.per_page', 100);
    $this->getJson('/api/v1/chats?per_page=0')->assertOk()->assertJsonPath('meta.per_page', 1);
});

it('runs the same number of queries however many chats there are', function () {
    $me = signIn();
    $seed = function (int $count) use ($me) {
        foreach (range(1, $count) as $_) {
            $friend = User::factory()->create();
            $direct = makeDirect($me, $friend);
            addMessage($direct, $friend);
            addMessage($direct, $me);
            $group = makeGroup($friend, [$me, User::factory()->create()]);
            addMessage($group, $friend);
        }
    };

    $seed(1);
    $few = countQueries(fn () => $this->getJson('/api/v1/chats')->assertOk());

    $seed(14);
    $many = countQueries(fn () => $this->getJson('/api/v1/chats?per_page=30')->assertOk());

    expect($this->getJson('/api/v1/chats?per_page=100')->json('data'))->toHaveCount(30)
        ->and($many)->toBe($few);
});

it('does not leak other users\' email or phone in the list', function () {
    $me = signIn();
    $friend = User::factory()->create(['phone' => '+66899999999']);
    $chat = makeDirect($me, $friend);
    addMessage($chat, $friend);
    makeGroup($friend, [$me, User::factory()->create(['phone' => '+66888888888'])]);

    $content = $this->getJson('/api/v1/chats')->getContent();

    expect($content)->not->toContain($friend->email)->not->toContain('+66899999999')->not->toContain('+66888888888');
});

it('requires authentication', function () {
    $this->getJson('/api/v1/chats')->assertUnauthorized();
});
