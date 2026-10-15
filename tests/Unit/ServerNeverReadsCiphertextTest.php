<?php

/*
| The server is a key directory and a ciphertext relay. These tests scan the source code as a
| safety net (the automated version of "grep the codebase"): nothing in app/ may decrypt anything,
| and any file that touches `ciphertext` may only store it, size-check it and hand it back.
*/

/** The project root. (Unit tests do not boot Laravel, so the framework's path helpers are not available.) */
function projectRoot(string $path = ''): string
{
    return dirname(__DIR__, 2).($path === '' ? '' : '/'.$path);
}

/** @return list<string> every PHP file under the given directory */
function phpFilesIn(string $directory): array
{
    $files = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS)) as $file) {
        if ($file->getExtension() === 'php') {
            $files[] = $file->getPathname();
        }
    }

    return $files;
}

function stripComments(string $source): string
{
    $code = '';
    foreach (token_get_all($source) as $token) {
        if (is_array($token) && in_array($token[0], [T_COMMENT, T_DOC_COMMENT], true)) {
            continue;
        }
        $code .= is_array($token) ? $token[1] : $token;
    }

    return $code;
}

it('contains no code that decrypts, opens or unseals anything', function () {
    $forbidden = [
        'sodium_crypto_box_open', 'sodium_crypto_box_seal_open', 'sodium_crypto_secretbox_open',
        'sodium_crypto_aead', 'sodium_crypto_stream', 'sodium_crypto_kx', 'sodium_crypto_sign_open',
        'openssl_decrypt', 'openssl_private_decrypt', 'openssl_open', 'mcrypt_decrypt',
        'Crypt::decrypt', 'decryptString', 'Encrypter',
    ];

    $found = [];
    foreach (phpFilesIn(projectRoot('app')) as $file) {
        $code = stripComments(file_get_contents($file));
        foreach ($forbidden as $needle) {
            if (str_contains($code, $needle)) {
                $found[] = str_replace(projectRoot().'/', '', $file)." uses {$needle}";
            }
        }
    }

    expect($found)->toBe([]);
});

it('only uses libsodium to verify a public signature', function () {
    $users = [];
    foreach (phpFilesIn(projectRoot('app')) as $file) {
        if (str_contains(stripComments(file_get_contents($file)), 'sodium_')) {
            $users[] = str_replace(projectRoot().'/', '', $file);
        }
    }

    expect($users)->toBe(['app/Services/SignedPrekeyVerifier.php']);
});

it('never holds a private key', function () {
    $found = [];
    foreach (phpFilesIn(projectRoot('app')) as $file) {
        $code = strtolower(stripComments(file_get_contents($file)));
        foreach (['secretkey', 'secret_key', 'private_key', 'privatekey'] as $needle) {
            if (str_contains($code, $needle)) {
                $found[] = str_replace(projectRoot().'/', '', $file)." mentions {$needle}";
            }
        }
    }

    expect($found)->toBe([]);
});

it('only lets a short list of files mention ciphertext, and they only store, size-check and return it', function () {
    $allowed = [
        'app/Actions/Messages/SendMessage.php',          // stores it
        'app/Http/Requests/Messages/StoreMessageRequest.php', // size and NUL checks
        'app/Http/Resources/EnvelopeResource.php',       // returns it
        'app/Models/MessageEnvelope.php',                // the row
    ];

    // Anything that would read inside the value: decoding, unpacking, hashing, parsing.
    $reading = ['base64_decode', 'base64_encode', 'bin2hex', 'hex2bin', 'unpack(', 'hash(', 'md5(', 'sha1(', 'crc32(', 'json_decode', 'unserialize', 'openssl_', 'sodium_', 'gzinflate', 'gzuncompress'];

    $mentioning = [];
    foreach (phpFilesIn(projectRoot('app')) as $file) {
        $relative = str_replace(projectRoot().'/', '', $file);
        $code = stripComments(file_get_contents($file));

        if (stripos($code, 'ciphertext') === false) {
            continue;
        }

        $mentioning[] = $relative;

        foreach ($reading as $needle) {
            expect(str_contains($code, $needle))->toBeFalse("{$relative} mentions ciphertext and calls {$needle}");
        }
    }

    expect($mentioning)->toEqualCanonicalizing($allowed);
});

it('does not log or dump ciphertext', function () {
    $found = [];
    foreach (phpFilesIn(projectRoot('app')) as $file) {
        $code = stripComments(file_get_contents($file));
        if (stripos($code, 'ciphertext') === false) {
            continue;
        }
        foreach (['Log::', 'logger(', 'report(', 'dd(', 'dump(', 'var_dump', 'print_r', 'error_log'] as $needle) {
            if (str_contains($code, $needle)) {
                $found[] = str_replace(projectRoot().'/', '', $file)." calls {$needle}";
            }
        }
    }

    expect($found)->toBe([]);
});

it('does not touch ciphertext outside app/ either (routes, config, migrations)', function () {
    $stored = ['database/migrations/2026_10_15_100001_create_devices_table.php', 'config/e2ee.php'];

    $found = [];
    foreach (['routes', 'config', 'database/migrations', 'database/seeders', 'bootstrap'] as $directory) {
        foreach (phpFilesIn(projectRoot($directory)) as $file) {
            if (stripos(stripComments(file_get_contents($file)), 'ciphertext') !== false) {
                $found[] = str_replace(projectRoot().'/', '', $file);
            }
        }
    }

    expect($found)->toEqualCanonicalizing($stored);
});
