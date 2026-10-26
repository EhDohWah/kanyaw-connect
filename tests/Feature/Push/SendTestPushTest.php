<?php

use App\Enums\PushOutcome;
use App\Models\NativePushToken;
use App\Models\User;
use App\Services\NativePush\ApnsMessage;

beforeEach(function () {
    $this->native = fakeNativePush();
    $this->user = User::factory()->create(['email' => 'naw@example.org']);
});

it('sends one ordinary notification to every phone of the account, and prints no token', function () {
    $android = NativePushToken::factory()->create(['user_id' => $this->user->id]);
    $iphone = NativePushToken::factory()->ios()->create(['user_id' => $this->user->id]);
    NativePushToken::factory()->create(); // someone else's phone

    $this->artisan('push:test', ['email' => 'naw@example.org'])
        ->expectsOutputToContain('sent')
        ->doesntExpectOutputToContain($android->token)
        ->doesntExpectOutputToContain($iphone->token)
        ->assertSuccessful();

    expect($this->native->sent)->toHaveCount(2)
        ->and($this->native->fcm()[0]->toArray()['android']['notification'])->toBe(['channel_id' => 'messages'])
        ->and($this->native->fcm()[0]->notification['body'])->toBe('Test notification: push works on this phone.')
        ->and($this->native->apns(ApnsMessage::ALERT))->toHaveCount(1)
        ->and($this->native->apns(ApnsMessage::VOIP))->toBe([]);
});

it('says when a platform has no credentials, and sends nothing there', function () {
    $this->native->configured['android'] = false;
    NativePushToken::factory()->create(['user_id' => $this->user->id]);

    $this->artisan('push:test', ['email' => 'naw@example.org'])
        ->expectsOutputToContain('skipped: no credentials for android')
        ->assertSuccessful();

    expect($this->native->sent)->toBe([]);
});

it('reports a dead token and removes that registration', function () {
    $phone = NativePushToken::factory()->create(['user_id' => $this->user->id]);
    $this->native->outcomes[$phone->token] = PushOutcome::Expired;

    $this->artisan('push:test', ['email' => 'naw@example.org'])
        ->expectsOutputToContain('refused')
        ->assertSuccessful();

    expect(NativePushToken::find($phone->id))->toBeNull();
});

it('fails clearly for an unknown account or one without phones', function () {
    $this->artisan('push:test', ['email' => 'nobody@example.org'])->expectsOutputToContain('No account')->assertFailed();
    $this->artisan('push:test', ['email' => 'naw@example.org'])->expectsOutputToContain('no registered phone')->assertFailed();
});
