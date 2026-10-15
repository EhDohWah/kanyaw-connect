<?php

namespace App\Exceptions;

use RuntimeException;

/**
 * A valid request that cannot be accepted given the current encryption state (for example envelopes
 * that do not match the members' devices). Rendered as { message, code, ...extra } with status 409.
 */
class EncryptionConflictException extends RuntimeException
{
    /**
     * @param  array<string, mixed>  $extra  additional fields for the response body
     */
    public function __construct(public readonly string $errorCode, string $message, public readonly array $extra = [], public readonly int $status = 409)
    {
        parent::__construct($message);
    }

    /**
     * @param  list<string>  $missing  devices that need an envelope and have none
     * @param  list<string>  $unexpected  devices that were given an envelope but must not get one
     */
    public static function envelopeMismatch(array $missing, array $unexpected): self
    {
        return new self(
            'envelope_mismatch',
            'The envelopes do not match the current devices of the chat members. Fetch key bundles for the missing devices and send again.',
            ['missing_device_ids' => array_values($missing), 'unexpected_device_ids' => array_values($unexpected)],
        );
    }

    public static function noRecipientDevices(): self
    {
        return new self('no_recipient_devices', 'None of the other members has set up encryption on any device yet, so there is nobody who could read this message.');
    }
}
