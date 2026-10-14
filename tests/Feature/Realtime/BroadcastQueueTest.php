<?php

use App\Events\MessageSent;
use App\Models\User;
use Illuminate\Broadcasting\BroadcastEvent;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;

it('queues a broadcast job for a worker instead of publishing during the request', function () {
    Queue::fake();
    $me = signIn();
    $chat = makeGroup($me, [User::factory()->create()]);

    $this->postJson("/api/v1/chats/{$chat->id}/messages", [
        'client_id' => (string) Str::uuid(),
        'type' => 'text',
        'content' => 'hello',
    ])->assertCreated();

    Queue::assertPushed(BroadcastEvent::class, fn (BroadcastEvent $job) => $job->event instanceof MessageSent);
});

it('keeps the payload as plain data so the worker needs no database access', function () {
    Queue::fake();
    $me = signIn();
    $chat = makeGroup($me);

    $this->postJson("/api/v1/chats/{$chat->id}/messages", [
        'client_id' => (string) Str::uuid(),
        'type' => 'text',
        'content' => 'hello',
    ])->assertCreated();

    Queue::assertPushed(BroadcastEvent::class, function (BroadcastEvent $job) {
        $serialized = serialize($job->event);

        // No Eloquent models inside the queued event.
        return ! str_contains($serialized, 'App\\Models') && ! str_contains($serialized, 'ModelIdentifier');
    });
});
