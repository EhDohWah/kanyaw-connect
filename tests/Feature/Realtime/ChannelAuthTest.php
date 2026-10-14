<?php

use App\Models\User;
use Illuminate\Support\Str;

function authorizeChannel($test, string $channel)
{
    return $test->postJson('/api/v1/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => $channel]);
}

beforeEach(function () {
    useReverbForChannelAuth();
    $this->me = User::factory()->create(['name' => 'Naw Paw', 'phone' => '+66812345678']);
    $this->other = User::factory()->create();
    $this->chat = makeGroup($this->other, [$this->me]);
});

describe('private-chat.{chatId}', function () {
    it('lets members subscribe', function () {
        signIn($this->me);

        authorizeChannel($this, "private-chat.{$this->chat->id}")->assertOk()->assertJsonStructure(['auth']);
    });

    it('refuses non-members', function () {
        signIn(User::factory()->create());

        authorizeChannel($this, "private-chat.{$this->chat->id}")->assertForbidden();
    });

    it('refuses someone who has left the chat', function () {
        $this->chat->chatMembers()->where('user_id', $this->me->id)->delete();
        signIn($this->me);

        authorizeChannel($this, "private-chat.{$this->chat->id}")->assertForbidden();
    });

    it('treats direct chats the same way', function () {
        $direct = makeDirect($this->me, $this->other);

        signIn($this->me);
        authorizeChannel($this, "private-chat.{$direct->id}")->assertOk();

        signIn(User::factory()->create());
        authorizeChannel($this, "private-chat.{$direct->id}")->assertForbidden();
    });

    it('refuses a chat that does not exist or an id that is not a uuid, without a server error', function (string $id) {
        signIn($this->me);

        authorizeChannel($this, "private-chat.{$id}")->assertForbidden();
    })->with([
        'unknown chat' => fn () => (string) Str::uuid(),
        'not a uuid' => 'not-a-uuid',
        'sql-ish' => "1' or '1'='1",
    ]);
});

describe('presence-chat.{chatId}', function () {
    it('lets members join and shares only id, name and avatar', function () {
        signIn($this->me);

        $response = authorizeChannel($this, "presence-chat.{$this->chat->id}")->assertOk()->assertJsonStructure(['auth', 'channel_data']);

        $channelData = json_decode($response->json('channel_data'), true);
        expect($channelData['user_id'])->toBe($this->me->id)
            ->and($channelData['user_info'])->toBe([
                'id' => $this->me->id,
                'name' => 'Naw Paw',
                'avatar_url' => null,
            ]);
        expect($response->getContent())->not->toContain($this->me->email)->not->toContain('+66812345678');
    });

    it('refuses non-members', function () {
        signIn(User::factory()->create());

        authorizeChannel($this, "presence-chat.{$this->chat->id}")->assertForbidden();
    });
});

describe('private-user.{userId}', function () {
    it('lets a user subscribe to their own channel only', function () {
        signIn($this->me);

        authorizeChannel($this, "private-user.{$this->me->id}")->assertOk();
        authorizeChannel($this, "private-user.{$this->other->id}")->assertForbidden();
    });
});

it('requires a bearer token', function () {
    authorizeChannel($this, "private-chat.{$this->chat->id}")->assertUnauthorized();
});

it('refuses channels that are not defined', function () {
    signIn($this->me);

    authorizeChannel($this, 'private-admin.everything')->assertForbidden();
    authorizeChannel($this, 'public-news')->assertForbidden();
});

it('works with a real bearer token, not just a faked login', function () {
    $token = $this->me->createToken('test')->plainTextToken;

    $this->withToken($token)
        ->postJson('/api/v1/broadcasting/auth', ['socket_id' => '1234.5678', 'channel_name' => "private-chat.{$this->chat->id}"])
        ->assertOk();
});
