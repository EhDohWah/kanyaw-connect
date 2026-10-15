<?php

use App\Enums\PushOutcome;
use App\Models\PushSubscription;
use App\Services\WebPushService;
use Database\Factories\PushSubscriptionFactory;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Illuminate\Support\Str;
use Minishlink\WebPush\VAPID;
use Tests\Support\WebPushDecryptor;

/**
 * These tests use the real WebPushService and library, with only the HTTP connection replaced by a
 * recorder. What reaches the "push service" is checked from the outside: the headers, and the
 * encrypted body decrypted the way a browser would.
 */
function realPushService(array $responses, array &$history, ?array $vapid = null): WebPushService
{
    $keys = VAPID::createVapidKeys();
    $stack = HandlerStack::create(new MockHandler($responses));
    $stack->push(Middleware::history($history));

    return new WebPushService(
        $vapid ?? ['subject' => 'mailto:ops@example.org', 'public_key' => $keys['publicKey'], 'private_key' => $keys['privateKey']],
        3600,
        'high',
        5,
        new Client(['handler' => $stack, 'http_errors' => false, 'allow_redirects' => false]),
    );
}

function browser(): array
{
    $keys = PushSubscriptionFactory::browserKeys();
    $subscription = PushSubscription::factory()->make([
        'endpoint' => 'https://fcm.googleapis.com/fcm/send/abc123',
        'p256dh_key' => $keys['p256dh'],
        'auth_key' => $keys['auth'],
    ]);
    $subscription->id = (string) Str::uuid();

    return [$subscription, $keys];
}

describe('what is sent', function () {
    it('posts to the browser\'s endpoint with VAPID, a time to live and an urgency', function () {
        $history = [];
        $service = realPushService([new Response(201)], $history);
        [$subscription] = browser();

        expect($service->send($subscription, ['body' => 'Hi']))->toBe(PushOutcome::Sent);

        $request = $history[0]['request'];
        expect($history)->toHaveCount(1)
            ->and($request->getMethod())->toBe('POST')
            ->and((string) $request->getUri())->toBe('https://fcm.googleapis.com/fcm/send/abc123')
            ->and($request->getHeaderLine('Content-Encoding'))->toBe('aes128gcm')
            ->and($request->getHeaderLine('TTL'))->toBe('3600')
            ->and($request->getHeaderLine('Urgency'))->toBe('high')
            ->and($request->getHeaderLine('Authorization'))->toStartWith('vapid t=')->toContain(', k=');
    });

    it('signs the request as this server (VAPID) for exactly the push service it is calling', function () {
        $history = [];
        $keys = VAPID::createVapidKeys();
        $service = realPushService([new Response(201)], $history, ['subject' => 'mailto:ops@example.org', 'public_key' => $keys['publicKey'], 'private_key' => $keys['privateKey']]);
        [$subscription] = browser();

        $service->send($subscription, ['body' => 'Hi']);

        preg_match('/t=([^,]+), k=(.+)$/', $history[0]['request']->getHeaderLine('Authorization'), $m);
        [$header, $claims] = array_map(fn ($part) => json_decode(base64_decode(strtr($part, '-_', '+/')), true), array_slice(explode('.', $m[1]), 0, 2));
        expect($m[2])->toBe($keys['publicKey'])
            ->and($header['alg'])->toBe('ES256')
            ->and($claims['aud'])->toBe('https://fcm.googleapis.com')
            ->and($claims['sub'])->toBe('mailto:ops@example.org')
            ->and($claims['exp'])->toBeGreaterThan(time())->toBeLessThanOrEqual(time() + 86400);
    });

    it('encrypts the payload so that only the subscribed browser can read it', function () {
        $history = [];
        $service = realPushService([new Response(201)], $history);
        [$subscription, $keys] = browser();
        $payload = ['title' => 'Naw Paw', 'body' => 'ကညီ — see you Saturday', 'chat_id' => 'c1'];

        $service->send($subscription, $payload);

        $body = (string) $history[0]['request']->getBody();
        expect($body)->not->toContain('Saturday')->not->toContain('Naw Paw')
            ->and(json_decode(WebPushDecryptor::decrypt($body, $keys), true))->toBe($payload);

        // Another browser's keys cannot open it.
        expect(fn () => WebPushDecryptor::decrypt($body, PushSubscriptionFactory::browserKeys()))->toThrow(RuntimeException::class);
    });

    it('pads every payload to the same size, so the length does not give the message away', function () {
        $history = [];
        $service = realPushService([new Response(201), new Response(201)], $history);
        [$subscription] = browser();

        $service->send($subscription, ['body' => 'Hi']);
        $service->send($subscription, ['body' => str_repeat('a long message ', 40)]);

        expect(strlen((string) $history[0]['request']->getBody()))->toBe(strlen((string) $history[1]['request']->getBody()));
    });

    it('uses a fresh encryption key and salt every time', function () {
        $history = [];
        $service = realPushService([new Response(201), new Response(201)], $history);
        [$subscription] = browser();

        $service->send($subscription, ['body' => 'Hi']);
        $service->send($subscription, ['body' => 'Hi']);

        expect(substr((string) $history[0]['request']->getBody(), 0, 16))->not->toBe(substr((string) $history[1]['request']->getBody(), 0, 16));
    });
});

describe('what comes back', function () {
    it('treats any 2xx as sent', function (int $status) {
        $history = [];
        [$subscription] = browser();

        expect(realPushService([new Response($status)], $history)->send($subscription, ['body' => 'x']))->toBe(PushOutcome::Sent);
    })->with([200, 201, 202]);

    it('treats 404 and 410 as a subscription that is gone', function (int $status) {
        $history = [];
        [$subscription] = browser();

        expect(realPushService([new Response($status)], $history)->send($subscription, ['body' => 'x']))->toBe(PushOutcome::Expired);
    })->with([404, 410]);

    it('treats other errors as temporary, not as a reason to delete the subscription', function (int $status) {
        $history = [];
        [$subscription] = browser();

        expect(realPushService([new Response($status)], $history)->send($subscription, ['body' => 'x']))->toBe(PushOutcome::Failed);
    })->with([
        'too many requests' => 429,
        'server error' => 500,
        'bad gateway' => 502,
        'unavailable' => 503,
        'rejected payload' => 413,
        'unauthorised VAPID' => 401,
        'forbidden' => 403,
        'bad request' => 400,
        'a redirect (never followed)' => 302,
    ]);

    it('treats a network failure as temporary', function () {
        $history = [];
        [$subscription] = browser();
        $service = realPushService([new ConnectException('timed out', new Request('POST', 'https://fcm.googleapis.com/x'))], $history);

        expect($service->send($subscription, ['body' => 'x']))->toBe(PushOutcome::Failed);
    });

    it('treats a subscription with unusable keys as a failure of that one, not a crash', function () {
        $history = [];
        [$subscription] = browser();
        $subscription->p256dh_key = PushSubscriptionFactory::base64Url("\x04".str_repeat("\x01", 64)); // not a point on the curve

        expect(realPushService([new Response(201)], $history)->send($subscription, ['body' => 'x']))->toBe(PushOutcome::Failed)
            ->and($history)->toBe([]);
    });

    it('lets a broken VAPID configuration surface instead of hiding it', function () {
        $history = [];
        [$subscription] = browser();
        $service = realPushService([new Response(201)], $history, ['subject' => 'mailto:ops@example.org', 'public_key' => 'nonsense', 'private_key' => 'nonsense']);

        expect(fn () => $service->send($subscription, ['body' => 'x']))->toThrow(ErrorException::class);
    });
});

describe('configuration', function () {
    it('is off until both VAPID keys are set', function (?string $public, ?string $private, bool $configured) {
        $service = new WebPushService(['subject' => 'mailto:a@b.c', 'public_key' => $public, 'private_key' => $private], 60, 'normal', 5);

        expect($service->isConfigured())->toBe($configured)
            ->and($service->publicKey())->toBe($configured ? $public : null);
    })->with([
        'neither' => [null, null, false],
        'empty strings' => ['', '', false],
        'only the public key' => ['pub', null, false],
        'only the private key' => [null, 'priv', false],
        'both' => ['pub', 'priv', true],
    ]);

    it('is built from config/push.php by the container', function () {
        config(['push.vapid.public_key' => 'config-public', 'push.vapid.private_key' => 'config-private', 'push.ttl_seconds' => 120]);
        app()->forgetInstance(WebPushService::class);

        expect(app(WebPushService::class)->publicKey())->toBe('config-public');
    });

    it('does not follow redirects and gives up after the configured time, but still sees HTTP error statuses', function () {
        $client = (new ReflectionMethod(WebPushService::class, 'defaultClient'))
            ->invoke(new WebPushService(['subject' => null, 'public_key' => 'a', 'private_key' => 'b'], 60, 'normal', 7));

        expect($client->getConfig('allow_redirects'))->toBeFalse()
            ->and($client->getConfig('http_errors'))->toBeFalse()
            ->and($client->getConfig('timeout'))->toBe(7)
            ->and($client->getConfig('connect_timeout'))->toBe(5);
    });
});

describe('php artisan push:vapid', function () {
    it('prints a usable key pair for the .env file', function () {
        $this->artisan('push:vapid')->assertSuccessful();

        Artisan::call('push:vapid');
        $output = Artisan::output();

        preg_match('/VAPID_PUBLIC_KEY=(\S+)/', $output, $public);
        preg_match('/VAPID_PRIVATE_KEY=(\S+)/', $output, $private);
        expect($public[1])->toHaveLength(87)   // 65 bytes
            ->and($private[1])->toHaveLength(43)   // 32 bytes
            ->and($output)->toContain('VAPID_SUBJECT=');

        $history = [];
        $service = realPushService([new Response(201)], $history, ['subject' => 'mailto:ops@example.org', 'public_key' => $public[1], 'private_key' => $private[1]]);
        [$subscription] = browser();
        expect($service->send($subscription, ['body' => 'x']))->toBe(PushOutcome::Sent);
    });

    it('makes a different pair every time', function () {
        Artisan::call('push:vapid');
        $first = Artisan::output();
        Artisan::call('push:vapid');

        expect(Artisan::output())->not->toBe($first);
    });
});
