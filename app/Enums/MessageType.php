<?php

namespace App\Enums;

enum MessageType: string
{
    case Text = 'text';
    case Image = 'image';
    case File = 'file';
    case Voice = 'voice';
    case System = 'system';

    /**
     * Types a client may send. System messages are only ever created by the server.
     *
     * @return list<string>
     */
    public static function sendable(): array
    {
        return [self::Text->value, self::Image->value, self::File->value, self::Voice->value];
    }
}
