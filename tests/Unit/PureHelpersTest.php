<?php

use App\Enums\MessageType;
use App\Models\Chat;
use App\Models\Message;
use App\Models\User;
use Carbon\CarbonImmutable;

// Unit tests: pure functions only, no database and no application container.

describe('Chat::directKeyFor', function () {
    it('gives the same key whichever user is passed first', function () {
        expect(Chat::directKeyFor('b-user', 'a-user'))->toBe(Chat::directKeyFor('a-user', 'b-user'))
            ->and(Chat::directKeyFor('b-user', 'a-user'))->toBe('a-user:b-user');
    });

    it('gives different keys for different pairs', function () {
        expect(Chat::directKeyFor('a', 'b'))->not->toBe(Chat::directKeyFor('a', 'c'));
    });
});

describe('User::thumbnailPathFor', function () {
    it('puts the thumbnail next to the original', function (string $original, string $thumbnail) {
        expect(User::thumbnailPathFor($original))->toBe($thumbnail);
    })->with([
        ['avatars/u1/abc.jpg', 'avatars/u1/abc_256.webp'],
        ['avatars/u1/abc.png', 'avatars/u1/abc_256.webp'],
        ['avatars/u.1/a.b.c.webp', 'avatars/u.1/a.b.c_256.webp'],
        ['avatars/u1/noextension', 'avatars/u1/noextension_256.webp'],
    ]);
});

describe('HasMicrosecondTimestamps::microseconds', function () {
    it('keeps all six digits of the fraction', function () {
        $date = CarbonImmutable::parse('2026-10-14 12:30:45.123456', 'UTC');

        expect(Message::microseconds($date))->toBe('2026-10-14 12:30:45.123456');
    });

    it('pads a zero fraction', function () {
        expect(Message::microseconds(CarbonImmutable::parse('2026-10-14 12:30:45', 'UTC')))->toBe('2026-10-14 12:30:45.000000');
    });
});

describe('MessageType::sendable', function () {
    it('lists what clients may send and never includes system', function () {
        expect(MessageType::sendable())->toBe(['text', 'image', 'file', 'voice'])
            ->and(MessageType::sendable())->not->toContain('system');
    });
});
