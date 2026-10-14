<?php

use App\Models\User;

beforeEach(function () {
    $this->me = signIn();
    $this->friend = User::factory()->create();
    $this->chat = makeDirect($this->me, $this->friend);
});

it('lists messages newest first', function () {
    $old = addMessage($this->chat, $this->friend, ['content' => 'old', 'created_at' => now()->subMinutes(3)]);
    $new = addMessage($this->chat, $this->me, ['content' => 'new', 'created_at' => now()->subMinute()]);
    $mid = addMessage($this->chat, $this->friend, ['content' => 'mid', 'created_at' => now()->subMinutes(2)]);

    $ids = collect($this->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertOk()->json('data'))->pluck('id')->all();

    expect($ids)->toBe([$new->id, $mid->id, $old->id]);
});

it('only returns messages of that chat', function () {
    addMessage($this->chat, $this->friend, ['content' => 'here']);
    addMessage(makeDirect($this->friend, User::factory()->create()), $this->friend, ['content' => 'elsewhere']);

    $this->getJson("/api/v1/chats/{$this->chat->id}/messages")
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.content', 'here');
});

it('hides deleted messages', function () {
    addMessage($this->chat, $this->friend, ['content' => 'kept']);
    addMessage($this->chat, $this->friend, ['content' => 'gone'])->delete();

    $this->getJson("/api/v1/chats/{$this->chat->id}/messages")
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.content', 'kept');
});

it('pages through history with cursors, keeping per_page, without gaps or repeats', function () {
    $expected = collect(range(1, 9))->map(
        fn ($i) => addMessage($this->chat, $this->friend, ['created_at' => now()->subMinutes($i)])->id
    );

    $seen = collect();
    $url = "/api/v1/chats/{$this->chat->id}/messages?per_page=4";
    $pages = 0;
    do {
        $page = $this->getJson($url)->assertOk();
        expect(count($page->json('data')))->toBeLessThanOrEqual(4);
        $seen = $seen->merge(collect($page->json('data'))->pluck('id'));
        $url = $page->json('links.next');
        $pages++;
    } while ($url);

    expect($seen->all())->toBe($expected->all())->and($pages)->toBe(3);
});

it('keeps paging correctly when messages share a timestamp', function () {
    $at = now()->subHour();
    $ids = collect(range(1, 7))->map(fn () => addMessage($this->chat, $this->friend, ['created_at' => $at])->id);

    $seen = collect();
    $url = "/api/v1/chats/{$this->chat->id}/messages?per_page=3";
    do {
        $page = $this->getJson($url)->assertOk();
        $seen = $seen->merge(collect($page->json('data'))->pluck('id'));
        $url = $page->json('links.next');
    } while ($url);

    expect($seen->unique())->toHaveCount(7)->and($seen->sort()->values()->all())->toBe($ids->sort()->values()->all());
});

it('keeps paging correctly for messages sent within the same second', function () {
    $base = now()->startOfSecond()->subHour();
    $expected = collect(range(5, 1))->map(
        fn ($i) => addMessage($this->chat, $this->friend, ['created_at' => $base->copy()->addMicroseconds($i * 1000)])->id
    );

    $seen = collect();
    $url = "/api/v1/chats/{$this->chat->id}/messages?per_page=2";
    do {
        $page = $this->getJson($url)->assertOk();
        $seen = $seen->merge(collect($page->json('data'))->pluck('id'));
        $url = $page->json('links.next');
    } while ($url);

    expect($seen->all())->toBe($expected->all());
});

it('defaults to 30 per page', function () {
    foreach (range(1, 32) as $i) {
        addMessage($this->chat, $this->friend, ['created_at' => now()->subMinutes($i)]);
    }

    $this->getJson("/api/v1/chats/{$this->chat->id}/messages")
        ->assertJsonCount(30, 'data')
        ->assertJsonPath('meta.per_page', 30);
});

it('shows a reply preview and masks it if the original was deleted', function () {
    $original = addMessage($this->chat, $this->friend, ['content' => 'secret plans']);
    addMessage($this->chat, $this->me, ['content' => 'ok', 'reply_to_id' => $original->id]);
    $original->delete();

    $row = $this->getJson("/api/v1/chats/{$this->chat->id}/messages")->json('data.0');

    expect($row['reply_to']['is_deleted'])->toBeTrue()
        ->and($row['reply_to']['content'])->toBeNull()
        ->and($row['reply_to_id'])->toBe($original->id);
});

it('only includes client_id on your own messages', function () {
    addMessage($this->chat, $this->friend, ['content' => 'theirs', 'created_at' => now()->subMinute()]);
    addMessage($this->chat, $this->me, ['content' => 'mine']);

    $rows = collect($this->getJson("/api/v1/chats/{$this->chat->id}/messages")->json('data'))->keyBy('content');

    expect($rows['mine'])->toHaveKey('client_id')->and($rows['theirs'])->not->toHaveKey('client_id');
});

it('does not expose senders\' email or phone', function () {
    $friend = User::factory()->create(['phone' => '+66877777777']);
    $group = makeGroup($this->me, [$friend]);
    addMessage($group, $friend);

    $content = $this->getJson("/api/v1/chats/{$group->id}/messages")->getContent();

    expect($content)->not->toContain($friend->email)->not->toContain('+66877777777');
});

it('runs the same number of queries for 3 messages and for 30', function () {
    foreach (range(1, 3) as $i) {
        $original = addMessage($this->chat, $this->friend, ['created_at' => now()->subMinutes(100 + $i)]);
        addMessage($this->chat, $this->me, ['reply_to_id' => $original->id, 'created_at' => now()->subMinutes($i)]);
    }
    $few = countQueries(fn () => $this->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertOk());

    foreach (range(1, 27) as $i) {
        $sender = $i % 2 ? $this->friend : $this->me;
        $original = addMessage($this->chat, $sender, ['created_at' => now()->subMinutes(300 + $i)]);
        addMessage($this->chat, $sender, ['reply_to_id' => $original->id, 'created_at' => now()->subMinutes(10 + $i)]);
    }
    $many = countQueries(fn () => $this->getJson("/api/v1/chats/{$this->chat->id}/messages?per_page=30")->assertOk());

    expect($many)->toBe($few);
});

it('requires membership', function () {
    signIn(User::factory()->create());

    $this->getJson("/api/v1/chats/{$this->chat->id}/messages")->assertForbidden();
});
