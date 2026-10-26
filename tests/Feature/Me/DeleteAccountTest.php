<?php

use App\Models\Attachment;
use App\Models\Chat;
use App\Models\ChatMember;
use App\Models\Device;
use App\Models\NativePushToken;
use App\Models\PushSubscription;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\PersonalAccessToken;

beforeEach(function () {
    Storage::fake('local');
    Storage::fake('public');
    fakeLiveKit();
    fakeBroadcasts();
    $this->leaving = User::factory()->create(['name' => 'Naw Paw', 'email' => 'naw@example.org', 'phone' => '+66812345678']);
    $this->friend = User::factory()->create(['name' => 'Saw Htoo']);
    $this->token = $this->leaving->createToken('Pixel 7 (Android)')->plainTextToken;
});

function deleteAccount($test, ?string $password = 'password')
{
    return $test->withToken($test->token)->deleteJson('/api/v1/me', $password === null ? [] : ['password' => $password]);
}

describe('checks', function () {
    it('needs a signed-in person', function () {
        $this->deleteJson('/api/v1/me', ['password' => 'password'])->assertUnauthorized();
    });

    it('refuses a wrong password with 422 and changes nothing', function () {
        deleteAccount($this, 'not-my-password')->assertUnprocessable()->assertJsonValidationErrors('password');

        $user = $this->leaving->fresh();
        expect($user)->not->toBeNull()
            ->and($user->trashed())->toBeFalse()
            ->and($user->name)->toBe('Naw Paw')
            ->and($user->tokens()->count())->toBe(1);
    });

    it('needs the password', function () {
        deleteAccount($this, null)->assertUnprocessable()->assertJsonValidationErrors('password');
    });

    it('is limited like a password change', function () {
        foreach (range(1, 5) as $_) {
            deleteAccount($this, 'wrong')->assertUnprocessable();
        }

        deleteAccount($this, 'password')->assertTooManyRequests();
    });
});

describe('what goes', function () {
    it('signs out every session and forgets the profile', function () {
        $this->leaving->createToken('Firefox');

        deleteAccount($this)->assertNoContent();

        $tombstone = User::withTrashed()->find($this->leaving->id);
        expect($tombstone->trashed())->toBeTrue()
            ->and($tombstone->name)->toBe('Deleted user')
            ->and($tombstone->email)->toBe("deleted-{$this->leaving->id}@deleted.invalid")
            ->and($tombstone->phone)->toBeNull()
            ->and($tombstone->avatar_path)->toBeNull()
            ->and($tombstone->email_verified_at)->toBeNull()
            ->and($tombstone->settings)->toBe([])
            ->and(PersonalAccessToken::where('tokenable_id', $this->leaving->id)->count())->toBe(0);

        app('auth')->forgetGuards();
        $this->withToken($this->token)->getJson('/api/v1/me')->assertUnauthorized();
    });

    it('cannot sign in any more, and the email address can register again', function () {
        deleteAccount($this)->assertNoContent();
        app('auth')->forgetGuards();

        $this->postJson('/api/v1/auth/login', ['email' => 'naw@example.org', 'password' => 'password'])->assertUnprocessable();
        $this->postJson('/api/v1/auth/register', [
            'name' => 'Naw Paw',
            'email' => 'naw@example.org',
            'password' => 'a-new-password',
            'password_confirmation' => 'a-new-password',
        ])->assertCreated();
    });

    it('removes push registrations, device keys and pending reset links', function () {
        NativePushToken::factory()->create(['user_id' => $this->leaving->id]);
        PushSubscription::factory()->create(['user_id' => $this->leaving->id]);
        makeDevice($this->leaving, prekeys: 3);
        DB::table('password_reset_tokens')->insert(['email' => 'naw@example.org', 'token' => 'x', 'created_at' => now()]);

        deleteAccount($this)->assertNoContent();

        expect(NativePushToken::where('user_id', $this->leaving->id)->count())->toBe(0)
            ->and(PushSubscription::where('user_id', $this->leaving->id)->count())->toBe(0)
            ->and(Device::where('user_id', $this->leaving->id)->count())->toBe(0)
            ->and(DB::table('one_time_prekeys')->count())->toBe(0)
            ->and(DB::table('password_reset_tokens')->where('email', 'naw@example.org')->exists())->toBeFalse();
    });

    it('deletes the avatar and every file the account uploaded', function () {
        $this->leaving->forceFill(['avatar_path' => "avatars/{$this->leaving->id}/me.jpg"])->save();
        Storage::disk('public')->put("avatars/{$this->leaving->id}/me.jpg", 'jpg');
        Storage::disk('public')->put("avatars/{$this->leaving->id}/me_256.webp", 'webp');
        $chat = makeDirect($this->leaving, $this->friend);
        $mine = Attachment::factory()->create(['chat_id' => $chat->id, 'uploader_id' => $this->leaving->id, 'thumbnail_path' => 'chat-attachments/test/thumb.webp']);
        $theirs = Attachment::factory()->create(['chat_id' => $chat->id, 'uploader_id' => $this->friend->id]);
        foreach ([$mine->path, $mine->thumbnail_path, $theirs->path] as $path) {
            Storage::disk('local')->put($path, 'bytes');
        }

        deleteAccount($this)->assertNoContent();

        Storage::disk('public')->assertMissing("avatars/{$this->leaving->id}/me.jpg");
        Storage::disk('public')->assertMissing("avatars/{$this->leaving->id}/me_256.webp");
        Storage::disk('local')->assertMissing($mine->path);
        Storage::disk('local')->assertMissing($mine->thumbnail_path);
        Storage::disk('local')->assertExists($theirs->path);
        expect(Attachment::find($mine->id))->toBeNull()
            ->and(Attachment::find($theirs->id))->not->toBeNull();
    });

    it('leaves every group, passing on ownership, and an empty group goes', function () {
        $owned = makeGroup($this->leaving, [$this->friend]);
        $alone = makeGroup($this->leaving);

        deleteAccount($this)->assertNoContent();

        expect(ChatMember::where('user_id', $this->leaving->id)->where('chat_id', $owned->id)->exists())->toBeFalse()
            ->and(ChatMember::where('chat_id', $owned->id)->where('user_id', $this->friend->id)->value('role')->value)->toBe('owner')
            ->and($owned->fresh()->member_count)->toBe(1)
            ->and(Chat::find($alone->id))->toBeNull();
    });

    it('ends calls: cancels one it is making, declines one ringing for it, ends one in progress', function () {
        $third = User::factory()->create();
        $making = makeCall($this->leaving, $this->friend);
        $ringing = makeCall($third, $this->leaving);
        $ongoing = makeCall($this->friend, $third, ['status' => 'ongoing', 'answered_at' => now()->subMinute()]);
        $ongoing->forceFill(['callee_id' => $this->leaving->id])->save();

        deleteAccount($this)->assertNoContent();

        expect($making->fresh()->status->value)->toBe('missed')
            ->and($making->fresh()->end_reason->value)->toBe('cancelled')
            ->and($ringing->fresh()->status->value)->toBe('declined')
            ->and($ongoing->fresh()->status->value)->toBe('ended');
    });

    it('ends the meetings it hosts, live or not yet started', function () {
        $live = makeRoom($this->leaving, ['status' => 'active']);
        $waiting = makeRoom($this->leaving);
        $friends = makeRoom($this->friend, ['status' => 'active']);

        deleteAccount($this)->assertNoContent();

        expect($live->fresh()->status->value)->toBe('ended')
            ->and($waiting->fresh()->status->value)->toBe('ended')
            ->and($friends->fresh()->status->value)->toBe('active');
    });
});

describe('what stays', function () {
    it('keeps its messages in other people\'s chats, from "Deleted user"', function () {
        $chat = makeGroup($this->friend, [$this->leaving]);
        $message = addMessage($chat, $this->leaving, ['content' => 'See you on Saturday']);

        deleteAccount($this)->assertNoContent();
        app('auth')->forgetGuards();
        signIn($this->friend);

        $row = collect($this->getJson("/api/v1/chats/{$chat->id}/messages")->assertOk()->json('data'))->firstWhere('id', $message->id);
        expect($row['content'])->toBe('See you on Saturday')
            ->and($row['sender_id'])->toBe($this->leaving->id)
            ->and($row['sender'])->toBe([
                'id' => $this->leaving->id,
                'name' => 'Deleted user',
                'avatar_url' => null,
                'avatar_thumb_url' => null,
                'is_deleted' => true,
            ]);
    });

    it('stays in a direct chat as "Deleted user", who can no longer be called', function () {
        $chat = makeDirect($this->leaving, $this->friend);

        deleteAccount($this)->assertNoContent();
        app('auth')->forgetGuards();
        signIn($this->friend);

        $listed = collect($this->getJson('/api/v1/chats')->assertOk()->json('data'))->firstWhere('id', $chat->id);
        expect($listed['other_user']['name'])->toBe('Deleted user')
            ->and($listed['other_user']['is_deleted'])->toBeTrue();

        $this->postJson("/api/v1/chats/{$chat->id}/calls", ['kind' => 'voice'])->assertForbidden();
    });

    it('keeps calls in the other person\'s history, with "Deleted user"', function () {
        $call = makeCall($this->leaving, $this->friend, ['status' => 'ended', 'answered_at' => now()->subMinutes(5), 'ended_at' => now()->subMinutes(2)]);

        deleteAccount($this)->assertNoContent();
        app('auth')->forgetGuards();
        signIn($this->friend);

        $this->getJson("/api/v1/calls/{$call->id}")->assertOk()->assertJsonPath('data.caller.name', 'Deleted user');
    });

    it('leaves other people\'s accounts untouched', function () {
        $friendToken = $this->friend->createToken('phone');
        NativePushToken::factory()->create(['user_id' => $this->friend->id]);
        PushSubscription::factory()->create(['user_id' => $this->friend->id]);
        makeDevice($this->friend, prekeys: 2);
        $this->friend->forceFill(['avatar_path' => "avatars/{$this->friend->id}/me.jpg"])->save();
        Storage::disk('public')->put("avatars/{$this->friend->id}/me.jpg", 'jpg');
        $chat = makeDirect($this->leaving, $this->friend);
        $theirMessage = addMessage($chat, $this->friend, ['content' => 'Hello']);

        deleteAccount($this)->assertNoContent();

        $friend = $this->friend->fresh();
        expect($friend->trashed())->toBeFalse()
            ->and($friend->name)->toBe('Saw Htoo')
            ->and(PersonalAccessToken::find($friendToken->accessToken->id))->not->toBeNull()
            ->and(NativePushToken::where('user_id', $friend->id)->count())->toBe(1)
            ->and(PushSubscription::where('user_id', $friend->id)->count())->toBe(1)
            ->and(Device::where('user_id', $friend->id)->count())->toBe(1)
            ->and(DB::table('one_time_prekeys')->count())->toBe(2)
            ->and($theirMessage->fresh()->content)->toBe('Hello')
            ->and(ChatMember::where('chat_id', $chat->id)->where('user_id', $friend->id)->exists())->toBeTrue();
        Storage::disk('public')->assertExists("avatars/{$friend->id}/me.jpg");
    });
});
