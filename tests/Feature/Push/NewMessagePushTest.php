<?php

use App\Actions\Push\DeliverPush;
use App\Actions\Push\NotifyMessageRecipients;
use App\Actions\Rooms\CreateRoom;
use App\Enums\PushOutcome;
use App\Jobs\RetryWebPush;
use App\Models\Attachment;
use App\Models\ChatMember;
use App\Models\Message;
use App\Models\PushSubscription;
use App\Models\User;
use App\Notifications\NewMessageNotification;
use App\Services\PresenceService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\SendQueuedNotifications;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

beforeEach(function () {
    $this->push = fakeWebPush();
    $this->sender = signIn(User::factory()->create(['name' => 'Saw Eh Doh']));
});

/** A user with browsers subscribed for push. */
function subscribed(array $userAttributes = [], int $browsers = 1): User
{
    $user = User::factory()->create($userAttributes);
    PushSubscription::factory()->count($browsers)->create(['user_id' => $user->id]);

    return $user;
}

function say($test, $chat, string $text, ?string $clientId = null)
{
    return $test->postJson("/api/v1/chats/{$chat->id}/messages", [
        'client_id' => $clientId ?? (string) Str::uuid(),
        'type' => 'text',
        'content' => $text,
    ]);
}

describe('who is notified', function () {
    it('notifies the other person in a direct chat, on every browser they subscribed', function () {
        $friend = subscribed(browsers: 2);
        $chat = makeDirect($this->sender, $friend);

        say($this, $chat, 'Are you coming on Saturday?')->assertCreated();

        expect($this->push->sentTo($friend))->toHaveCount(2)
            ->and($this->push->notifiedUserIds())->toBe([$friend->id]);
    });

    it('never notifies the sender, not even on their own browsers', function () {
        PushSubscription::factory()->create(['user_id' => $this->sender->id]);
        $friend = subscribed();

        say($this, makeDirect($this->sender, $friend), 'Hello')->assertCreated();

        expect($this->push->notifiedUserIds())->toBe([$friend->id]);
    });

    it('notifies every member of a group except the sender', function () {
        [$a, $b, $c] = [subscribed(), subscribed(), subscribed()];
        PushSubscription::factory()->create(['user_id' => $this->sender->id]);
        $chat = makeGroup($this->sender, [$a, $b, $c]);

        say($this, $chat, 'Meeting at 7')->assertCreated();

        expect($this->push->notifiedUserIds())->toEqualCanonicalizing([$a->id, $b->id, $c->id]);
    });

    it('skips people who have no subscribed browser', function () {
        $with = subscribed();
        $without = User::factory()->create();

        say($this, makeGroup($this->sender, [$with, $without]), 'Hi')->assertCreated();

        expect($this->push->notifiedUserIds())->toBe([$with->id]);
    });

    it('does not notify people outside the chat, even if they subscribed', function () {
        $member = subscribed();
        $outsider = subscribed();

        say($this, makeGroup($this->sender, [$member]), 'Hi')->assertCreated();

        expect($this->push->notifiedUserIds())->toBe([$member->id]);
    });

    it('skips people who left the chat or were removed', function () {
        $stayed = subscribed();
        $gone = subscribed();
        $chat = makeGroup($this->sender, [$stayed, $gone]);
        ChatMember::where('chat_id', $chat->id)->where('user_id', $gone->id)->delete();

        say($this, $chat, 'Hi')->assertCreated();

        expect($this->push->notifiedUserIds())->toBe([$stayed->id]);
    });

    it('skips deleted accounts', function () {
        $active = subscribed();
        $deleted = subscribed();
        $deleted->delete();

        say($this, makeGroup($this->sender, [$active, $deleted]), 'Hi')->assertCreated();

        expect($this->push->notifiedUserIds())->toBe([$active->id]);
    });

    describe('muted chats', function () {
        it('respects a mute with no end time', function () {
            $friend = subscribed();
            $chat = makeDirect($this->sender, $friend);
            ChatMember::where('chat_id', $chat->id)->where('user_id', $friend->id)->update(['is_muted' => true]);

            say($this, $chat, 'Hi')->assertCreated();

            expect($this->push->sent)->toBe([]);
        });

        it('respects a mute that has not ended yet', function () {
            $friend = subscribed();
            $chat = makeDirect($this->sender, $friend);
            ChatMember::where('chat_id', $chat->id)->where('user_id', $friend->id)->update(['is_muted' => true, 'muted_until' => ts(now()->addHour())]);

            say($this, $chat, 'Hi')->assertCreated();

            expect($this->push->sent)->toBe([]);
        });

        it('notifies again once the mute has run out', function () {
            $friend = subscribed();
            $chat = makeDirect($this->sender, $friend);
            ChatMember::where('chat_id', $chat->id)->where('user_id', $friend->id)->update(['is_muted' => true, 'muted_until' => ts(now()->subMinute())]);

            say($this, $chat, 'Hi')->assertCreated();

            expect($this->push->notifiedUserIds())->toBe([$friend->id]);
        });

        it('only silences the member who muted', function () {
            [$muting, $other] = [subscribed(), subscribed()];
            $chat = makeGroup($this->sender, [$muting, $other]);
            ChatMember::where('chat_id', $chat->id)->where('user_id', $muting->id)->update(['is_muted' => true]);

            say($this, $chat, 'Hi')->assertCreated();

            expect($this->push->notifiedUserIds())->toBe([$other->id]);
        });
    });

    describe('people who are online', function () {
        it('skips someone whose app is open (their heartbeat is alive)', function () {
            $online = subscribed();
            $offline = subscribed();
            app(PresenceService::class)->heartbeat($online);

            say($this, makeGroup($this->sender, [$online, $offline]), 'Hi')->assertCreated();

            expect($this->push->notifiedUserIds())->toBe([$offline->id]);
        });

        it('notifies them once the heartbeat has lapsed', function () {
            $friend = subscribed();
            app(PresenceService::class)->heartbeat($friend);

            $this->travel(config('chat.presence.ttl_seconds') + 5)->seconds();
            say($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

            expect($this->push->notifiedUserIds())->toBe([$friend->id]);
        });

        it('can be told to notify them anyway', function () {
            config(['push.skip_online_users' => false]);
            $friend = subscribed();
            app(PresenceService::class)->heartbeat($friend);

            say($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

            expect($this->push->notifiedUserIds())->toBe([$friend->id]);
        });
    });
});

describe('what the notification says', function () {
    it('shows the sender and the message in a direct chat', function () {
        $friend = subscribed();
        $chat = makeDirect($this->sender, $friend);

        $message = say($this, $chat, 'Are you coming on Saturday?')->assertCreated()->json('data');

        expect($this->push->sentTo($friend)[0]['payload'])->toMatchArray([
            'type' => 'message.new',
            'title' => 'Saw Eh Doh',
            'body' => 'Are you coming on Saturday?',
            'chat_id' => $chat->id,
            'message_id' => $message['id'],
            'message_type' => 'text',
            'encrypted' => false,
        ]);
    });

    it('shows the group name as the title and who wrote in a group', function () {
        $friend = subscribed();
        $chat = makeGroup($this->sender, [$friend], attributes: ['name' => 'Community committee']);

        say($this, $chat, 'Meeting at 7')->assertCreated();

        expect($this->push->sentTo($friend)[0]['payload'])->toMatchArray([
            'title' => 'Community committee',
            'body' => 'Saw Eh Doh: Meeting at 7',
        ]);
    });

    it('tidies whitespace and cuts a long message', function () {
        $friend = subscribed();
        $chat = makeDirect($this->sender, $friend);

        say($this, $chat, "  Line one\n\n   line   two  ")->assertCreated();
        say($this, $chat, str_repeat('word ', 100))->assertCreated();

        [$short, $long] = array_column($this->push->sentTo($friend), 'payload');
        expect($short['body'])->toBe('Line one line two')
            ->and(mb_strlen($long['body']))->toBe(101)
            ->and($long['body'])->toEndWith('…');
    });

    it('never cuts a Karen or Burmese letter apart from its marks', function () {
        config(['push.preview_length' => 10]);
        $friend = subscribed();
        // Each of these characters is a consonant followed by combining vowel/tone signs: 3 code points.
        $text = str_repeat("က\u{102D}\u{102F}", 25);

        say($this, makeDirect($this->sender, $friend), $text)->assertCreated();

        $body = $this->push->sentTo($friend)[0]['payload']['body'];
        preg_match_all('/\X/u', rtrim($body, '…'), $characters);
        expect($characters[0])->toHaveCount(10)
            ->and(collect($characters[0])->every(fn ($c) => $c === "က\u{102D}\u{102F}"))->toBeTrue()
            ->and($body)->toEndWith('…');
    });

    it('describes media instead of showing a file name', function (string $type, string $mime, string $expected) {
        $friend = subscribed();
        $chat = makeDirect($this->sender, $friend);
        $attachment = Attachment::factory()->create([
            'chat_id' => $chat->id, 'uploader_id' => $this->sender->id, 'mime_type' => $mime, 'original_name' => 'private-report.pdf',
        ]);

        $this->postJson("/api/v1/chats/{$chat->id}/messages", [
            'client_id' => (string) Str::uuid(), 'type' => $type, 'metadata' => ['attachment_id' => $attachment->id],
        ])->assertCreated();

        $payload = $this->push->sentTo($friend)[0]['payload'];
        expect($payload['body'])->toBe($expected)
            ->and($payload['message_type'])->toBe($type)
            ->and(json_encode($payload))->not->toContain('private-report');
    })->with([
        'a photo' => ['image', 'image/png', 'Sent a photo'],
        'a voice message' => ['voice', 'audio/ogg', 'Sent a voice message'],
        'a file' => ['file', 'application/pdf', 'Sent a file'],
    ]);

    it('can be limited to "New message" while still naming the chat', function () {
        config(['push.show_preview' => false]);
        $friend = subscribed();

        say($this, makeDirect($this->sender, $friend), 'My secret plan')->assertCreated();

        $payload = $this->push->sentTo($friend)[0]['payload'];
        expect($payload['body'])->toBe('New message')
            ->and(json_encode($payload))->not->toContain('My secret plan');
    });
});

describe('encrypted chats', function () {
    it('say only "New message": no sender, no chat name, no content', function () {
        $friend = subscribed(['name' => 'Naw Paw Say']);
        $chat = makeEncryptedGroup($this->sender, [$friend]);
        $chat->update(['name' => 'Secret committee']);
        $from = makeDevice($this->sender);
        $to = makeDevice($friend);
        $envelopes = envelopesFor([$to]);

        $message = sendEncrypted($this, $chat, $from, $envelopes)->assertCreated()->json('data');

        $payload = $this->push->sentTo($friend)[0]['payload'];
        expect($payload)->toBe([
            'type' => 'message.new',
            'chat_id' => $chat->id,
            'message_id' => $message['id'],
            'sent_at' => $payload['sent_at'],
            'encrypted' => true,
            'title' => config('app.name'),
            'body' => 'New message',
        ]);

        $everything = json_encode($payload);
        expect($everything)->not->toContain('Saw Eh Doh')
            ->and($everything)->not->toContain('Naw Paw Say')
            ->and($everything)->not->toContain('Secret committee')
            ->and($everything)->not->toContain($envelopes[0]['ciphertext']);
    });

    it('stay generic whatever the preview setting', function () {
        config(['push.show_preview' => true]);
        $friend = subscribed();
        $chat = makeEncryptedDirect($this->sender, $friend);

        sendEncrypted($this, $chat, makeDevice($this->sender), envelopesFor([makeDevice($friend)]))->assertCreated();

        expect($this->push->sentTo($friend)[0]['payload']['body'])->toBe('New message');
    });

    it('never put any message content into the queue', function () {
        Queue::fake([SendQueuedNotifications::class]);
        $friend = subscribed();
        $chat = makeEncryptedDirect($this->sender, $friend);
        $envelopes = envelopesFor([makeDevice($friend)]);

        sendEncrypted($this, $chat, makeDevice($this->sender), $envelopes)->assertCreated();

        Queue::assertPushed(SendQueuedNotifications::class, function ($job) use ($envelopes) {
            return ! str_contains(serialize($job), $envelopes[0]['ciphertext']) && ! str_contains(serialize($job), 'Saw Eh Doh');
        });
    });
});

describe('video room announcements', function () {
    it('notify the chat members but not the host', function () {
        $member = subscribed();
        PushSubscription::factory()->create(['user_id' => $this->sender->id]);
        $chat = makeGroup($this->sender, [$member], attributes: ['name' => 'Committee']);

        $room = app(CreateRoom::class)->handle($this->sender, ['name' => 'Weekly call', 'chat_id' => $chat->id]);

        expect($this->push->notifiedUserIds())->toBe([$member->id]);
        $payload = $this->push->sentTo($member)[0]['payload'];
        expect($payload)->toMatchArray([
            'title' => 'Committee',
            'body' => 'Saw Eh Doh started a video room: Weekly call',
            'message_type' => 'system',
            'room_id' => $room->id,
        ]);
    });

    it('are generic in an encrypted chat', function () {
        $member = subscribed();
        $chat = makeEncryptedGroup($this->sender, [$member]);

        app(CreateRoom::class)->handle($this->sender, ['name' => 'Weekly call', 'chat_id' => $chat->id]);

        expect($this->push->sentTo($member)[0]['payload']['body'])->toBe('New message');
    });
});

describe('delivery', function () {
    it('goes through the queue, one notification per person', function () {
        Queue::fake([SendQueuedNotifications::class]);
        [$a, $b] = [subscribed(), subscribed()];

        say($this, makeGroup($this->sender, [$a, $b]), 'Hi')->assertCreated();

        Queue::assertPushed(SendQueuedNotifications::class, 2);
        expect(NewMessageNotification::class)->toImplement(ShouldQueue::class);
    });

    it('asks no extra database questions as the group grows', function () {
        Queue::fake([SendQueuedNotifications::class]);
        $small = makeGroup($this->sender, [subscribed(), subscribed()]);
        $large = makeGroup($this->sender, array_map(fn () => subscribed(), range(1, 25)));
        $notify = fn ($chat) => countQueries(fn () => app(NotifyMessageRecipients::class)->handle(addMessage($chat, $this->sender)));

        $notify($small); // warm any caches
        expect($notify($large))->toBe($notify($small));
    });

    it('removes a browser the push service has forgotten, and still reaches the others', function () {
        $friend = User::factory()->create();
        [$gone, $alive] = PushSubscription::factory()->count(2)->create(['user_id' => $friend->id]);
        $this->push->outcomes[$gone->endpoint] = PushOutcome::Expired;

        say($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        expect($this->push->sentTo($friend))->toHaveCount(2)
            ->and(PushSubscription::pluck('id')->all())->toBe([$alive->id]);
    });

    it('retries only the browser that failed, later', function () {
        Queue::fake([RetryWebPush::class]);
        $friend = User::factory()->create();
        [$flaky, $fine] = PushSubscription::factory()->count(2)->create(['user_id' => $friend->id]);
        $this->push->outcomes[$flaky->endpoint] = PushOutcome::Failed;

        say($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        Queue::assertPushed(RetryWebPush::class, 1);
        Queue::assertPushed(RetryWebPush::class, fn (RetryWebPush $job) => $job->subscriptionId === $flaky->id
            && $job->payload['body'] === 'Hi'
            && $job->delay === 30);
        expect(PushSubscription::count())->toBe(2); // temporary trouble does not delete anything
    });

    it('does nothing when push is not configured', function () {
        $this->push->configured = false;
        $friend = subscribed();

        say($this, makeDirect($this->sender, $friend), 'Hi')->assertCreated();

        expect($this->push->sent)->toBe([]);
    });

    it('never fails the message because notifying failed', function () {
        Exceptions::fake();
        $this->push->throws = new RuntimeException('push service exploded');
        $friend = subscribed();
        $chat = makeDirect($this->sender, $friend);

        say($this, $chat, 'Still delivered')->assertCreated()->assertJsonPath('data.content', 'Still delivered');

        expect(Message::where('chat_id', $chat->id)->count())->toBe(1);
        Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'push service exploded');
    });

    it('does not notify again when the client retries the same message', function () {
        $friend = subscribed();
        $chat = makeDirect($this->sender, $friend);
        $clientId = (string) Str::uuid();

        say($this, $chat, 'Hi', $clientId)->assertCreated();
        say($this, $chat, 'Hi', $clientId)->assertOk();

        expect($this->push->sent)->toHaveCount(1);
    });
});

describe('the retry job', function () {
    it('delivers to the browser it was made for', function () {
        $subscription = PushSubscription::factory()->create();

        (new RetryWebPush($subscription->id, ['body' => 'Hi']))->handle(app(DeliverPush::class));

        expect($this->push->sent)->toHaveCount(1)->and($this->push->sent[0]['payload'])->toBe(['body' => 'Hi']);
    });

    it('fails again (so the queue backs off and retries) while the push service is unavailable', function () {
        $subscription = PushSubscription::factory()->create();
        $this->push->outcomes[$subscription->endpoint] = PushOutcome::Failed;

        expect(fn () => (new RetryWebPush($subscription->id, ['body' => 'Hi']))->handle(app(DeliverPush::class)))
            ->toThrow(RuntimeException::class);

        expect((new RetryWebPush('x', []))->tries)->toBe(3)->and((new RetryWebPush('x', []))->backoff())->toBe([60, 300]);
    });

    it('gives up and deletes the subscription when the push service says it is gone', function () {
        $subscription = PushSubscription::factory()->create();
        $this->push->outcomes[$subscription->endpoint] = PushOutcome::Expired;

        (new RetryWebPush($subscription->id, ['body' => 'Hi']))->handle(app(DeliverPush::class));

        expect(PushSubscription::count())->toBe(0);
    });

    it('does nothing if the browser has since signed out', function () {
        (new RetryWebPush((string) Str::uuid(), ['body' => 'Hi']))->handle(app(DeliverPush::class));

        expect($this->push->sent)->toBe([]);
    });
});
