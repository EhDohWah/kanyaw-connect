<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A request that is valid but not possible in the room's current state (ended, locked, full, …).
 * Rendered as { message, code } so clients can branch on `code`.
 */
class RoomConflictException extends RuntimeException
{
    public function __construct(public readonly string $errorCode, string $message, public readonly int $status = 409)
    {
        parent::__construct($message);
    }

    public static function ended(): self
    {
        return new self('room_ended', 'This room has ended.');
    }

    public static function locked(): self
    {
        return new self('room_locked', 'This room is locked. The host is not letting new people in.');
    }

    public static function full(): self
    {
        return new self('room_full', 'This room is full.');
    }

    public static function denied(): self
    {
        return new self('join_denied', 'The host has not allowed you to join this room.', 403);
    }
}
