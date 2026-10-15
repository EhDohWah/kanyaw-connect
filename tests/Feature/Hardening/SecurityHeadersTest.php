<?php

use App\Models\Attachment;
use App\Models\User;
use App\Providers\AppServiceProvider;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Support\Facades\Storage;

afterEach(fn () => TrustProxies::flushState());

function expectSecurityHeaders($response): void
{
    expect($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($response->headers->get('X-Frame-Options'))->toBe('DENY')
        ->and($response->headers->get('Referrer-Policy'))->toBe('no-referrer')
        ->and($response->headers->get('Content-Security-Policy'))->toContain("default-src 'none'")->toContain("frame-ancestors 'none'")
        ->and($response->headers->get('Permissions-Policy'))->toContain('camera=()')
        ->and($response->headers->get('Cache-Control'))->toContain('no-store');
}

it('adds the headers to successful responses', function () {
    expectSecurityHeaders($this->actingAs(User::factory()->create(), 'sanctum')->getJson('/api/v1/me')->assertOk());
});

it('adds the headers to every kind of error response', function (string $method, string $uri, int $status) {
    expectSecurityHeaders($this->json($method, $uri, [])->assertStatus($status));
})->with([
    'unauthenticated' => ['GET', '/api/v1/me', 401],
    'not found' => ['GET', '/api/v1/does-not-exist', 404],
    'wrong method' => ['DELETE', '/api/v1/auth/login', 405],
    'validation error' => ['POST', '/api/v1/auth/login', 422],
    'bad webhook signature' => ['POST', '/api/v1/webhooks/livekit', 401],
]);

it('adds the headers to the health check', function () {
    expectSecurityHeaders($this->get('/up')->assertOk());
});

it('leaves the stricter headers of attachment downloads alone', function () {
    Storage::fake('local');
    $a = User::factory()->create();
    $chat = makeDirect($a, User::factory()->create());
    $attachment = Attachment::factory()->create(['chat_id' => $chat->id, 'uploader_id' => $a->id, 'path' => 'file.bin']);
    Storage::disk('local')->put('file.bin', 'bytes');

    $response = $this->get($attachment->fileUrl())->assertOk();

    expect($response->headers->get('Content-Security-Policy'))->toBe("default-src 'none'; sandbox")
        ->and($response->headers->get('Cache-Control'))->toContain('max-age=3600')->not->toContain('no-store')
        ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and($response->headers->get('X-Frame-Options'))->toBe('DENY');
});

describe('Strict-Transport-Security', function () {
    it('is not sent over plain HTTP', function () {
        expect($this->get('http://localhost/up')->headers->has('Strict-Transport-Security'))->toBeFalse();
    });

    it('is sent over HTTPS', function () {
        expect($this->get('https://localhost/up')->headers->get('Strict-Transport-Security'))->toBe('max-age=31536000; includeSubDomains');
    });

    it('can be turned off', function () {
        config(['security.hsts.enabled' => false]);

        expect($this->get('https://localhost/up')->headers->has('Strict-Transport-Security'))->toBeFalse();
    });

    it('is sent behind a trusted TLS-terminating proxy', function () {
        TrustProxies::at('*');

        $response = $this->get('http://localhost/up', ['X-Forwarded-Proto' => 'https']);

        expect($response->headers->has('Strict-Transport-Security'))->toBeTrue();
    });

    it('is not triggered by an X-Forwarded-Proto header from a proxy nobody trusts', function () {
        $response = $this->get('http://localhost/up', ['X-Forwarded-Proto' => 'https']);

        expect($response->headers->has('Strict-Transport-Security'))->toBeFalse();
    });
});

describe('TRUSTED_PROXIES', function () {
    function trustedProxyRequest($test, string $fromIp)
    {
        return $test->call('GET', 'http://localhost/up', [], [], [], [
            'REMOTE_ADDR' => $fromIp,
            'HTTP_X_FORWARDED_PROTO' => 'https',
            'HTTP_X_FORWARDED_FOR' => '198.51.100.7',
        ]);
    }

    it('trusts only the configured proxies', function () {
        config(['security.trusted_proxies' => '10.0.0.0/8, 192.168.1.1']);
        (new AppServiceProvider($this->app))->boot();

        expect(trustedProxyRequest($this, '10.1.2.3')->headers->has('Strict-Transport-Security'))->toBeTrue();
        expect(trustedProxyRequest($this, '192.168.1.1')->headers->has('Strict-Transport-Security'))->toBeTrue();
        expect(trustedProxyRequest($this, '203.0.113.9')->headers->has('Strict-Transport-Security'))->toBeFalse();
    });

    it('takes the real client address from a trusted proxy (so rate limits see the person, not the proxy)', function () {
        config(['security.trusted_proxies' => '*']);
        (new AppServiceProvider($this->app))->boot();

        $this->call('GET', 'http://localhost/up', [], [], [], ['REMOTE_ADDR' => '10.1.2.3', 'HTTP_X_FORWARDED_FOR' => '198.51.100.7']);

        expect(request()->ip())->toBe('198.51.100.7');
    });
});
