<?php

return [

    /*
    | The server is a key directory and a ciphertext relay. It stores public keys and opaque
    | encrypted blobs; it never sees a private key or any plaintext.
    */

    // Active devices per user. Every encrypted message needs one envelope per device of every member,
    // so this also bounds the cost of sending.
    'max_devices_per_user' => 10,

    // One-time prekeys: how many a new device uploads, how many can be added at once, and how many
    // unclaimed ones the server will hold for one device.
    'prekeys' => [
        'register_min' => 20,
        'register_max' => 100,
        'topup_max' => 100,
        'pool_max' => 200,
    ],

    // Check that the signed prekey is signed by the device's identity key. Only public keys are
    // involved. The signed message is the raw 32-byte signed prekey public key (see README).
    'verify_signed_prekey' => (bool) env('E2EE_VERIFY_SIGNED_PREKEY', true),

    // Limits for one encrypted message. The server only checks sizes, never contents.
    'envelopes' => [
        'max_per_message' => 1000,
        'max_ciphertext_chars' => 32768,
        'max_header_bytes' => 4096,
    ],

    // last_active_at is refreshed at most this often per device.
    'last_active_throttle_minutes' => 5,

];
