<?php

use App\Models\Attachment;
use App\Models\User;
use Illuminate\Support\Facades\Storage;

const FRONTEND = 'https://chat.example.org';

beforeEach(function () {
    // Two origins, so the library answers with the caller's origin (when allowed) rather than a fixed one.
    config(['cors.allowed_origins' => [FRONTEND, 'https://admin.example.org']]);
});

it('answers a preflight from the frontend, allowing the headers the app uses', function () {
    $response = $this->call('OPTIONS', '/api/v1/chats/abc/messages', [], [], [], [
        'HTTP_ORIGIN' => FRONTEND,
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'POST',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'authorization, content-type, x-device-id, x-socket-id',
    ]);

    $response->assertNoContent();
    expect($response->headers->get('Access-Control-Allow-Origin'))->toBe(FRONTEND)
        ->and($response->headers->get('Access-Control-Max-Age'))->toBe('600')
        ->and($response->headers->has('Access-Control-Allow-Credentials'))->toBeFalse();

    $allowed = strtolower($response->headers->get('Access-Control-Allow-Headers'));
    foreach (['authorization', 'content-type', 'x-device-id', 'x-socket-id'] as $header) {
        expect($allowed)->toContain($header);
    }

    $methods = $response->headers->get('Access-Control-Allow-Methods');
    foreach (['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as $method) {
        expect($methods)->toContain($method);
    }
});

it('does not allow other origins', function () {
    $response = $this->call('OPTIONS', '/api/v1/me', [], [], [], [
        'HTTP_ORIGIN' => 'https://evil.example',
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
    ]);

    expect($response->headers->has('Access-Control-Allow-Origin'))->toBeFalse();

    $actual = $this->withHeader('Origin', 'https://evil.example')->withToken(User::factory()->create()->createToken('t')->plainTextToken)->getJson('/api/v1/me');
    $actual->assertOk();
    expect($actual->headers->has('Access-Control-Allow-Origin'))->toBeFalse();
});

it('does not allow headers the app does not use', function () {
    $response = $this->call('OPTIONS', '/api/v1/me', [], [], [], [
        'HTTP_ORIGIN' => FRONTEND,
        'HTTP_ACCESS_CONTROL_REQUEST_METHOD' => 'GET',
        'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'x-something-else',
    ]);

    expect(strtolower((string) $response->headers->get('Access-Control-Allow-Headers')))->not->toContain('x-something-else');
});

it('marks real responses for the frontend and exposes the back-off headers', function () {
    $user = User::factory()->create();

    $response = $this->actingAs($user, 'sanctum')->withHeader('Origin', FRONTEND)->getJson('/api/v1/me');

    $response->assertOk();
    expect($response->headers->get('Access-Control-Allow-Origin'))->toBe(FRONTEND)
        ->and(strtolower($response->headers->get('Access-Control-Expose-Headers')))->toContain('retry-after')
        ->and($response->headers->get('Vary'))->toContain('Origin');
});

it('lets the frontend download attachments (encrypted ones must be fetched, then decrypted)', function () {
    Storage::fake('local');
    $a = User::factory()->create();
    $chat = makeDirect($a, User::factory()->create());
    $attachment = Attachment::factory()->create(['chat_id' => $chat->id, 'uploader_id' => $a->id, 'path' => 'blob.bin']);
    Storage::disk('local')->put('blob.bin', 'opaque');

    $response = $this->withHeader('Origin', FRONTEND)->get($attachment->fileUrl());

    $response->assertOk();
    expect($response->headers->get('Access-Control-Allow-Origin'))->toBe(FRONTEND);
});

it('reads several allowed origins from CORS_ALLOWED_ORIGINS, falling back to FRONTEND_URL', function () {
    $load = function (array $env) {
        $saved = [];
        foreach (['CORS_ALLOWED_ORIGINS', 'FRONTEND_URL'] as $key) {
            $saved[$key] = $_SERVER[$key] ?? null;
            unset($_SERVER[$key], $_ENV[$key]);
        }
        foreach ($env as $key => $value) {
            $_SERVER[$key] = $_ENV[$key] = $value;
        }

        try {
            return require base_path('config/cors.php');
        } finally {
            foreach ($saved as $key => $value) {
                unset($_SERVER[$key], $_ENV[$key]);
                if ($value !== null) {
                    $_SERVER[$key] = $_ENV[$key] = $value;
                }
            }
        }
    };

    expect($load(['CORS_ALLOWED_ORIGINS' => 'https://a.example, https://b.example ,'])['allowed_origins'])->toBe(['https://a.example', 'https://b.example'])
        ->and($load(['FRONTEND_URL' => 'https://front.example'])['allowed_origins'])->toBe(['https://front.example'])
        ->and($load([])['allowed_origins'])->toBe(['http://localhost:5173']);
});
