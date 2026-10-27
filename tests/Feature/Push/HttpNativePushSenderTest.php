<?php

use App\Enums\PushOutcome;
use App\Enums\PushPlatform;
use App\Services\NativePush\ApnsMessage;
use App\Services\NativePush\FcmMessage;
use App\Services\NativePush\HttpNativePushSender;
use App\Services\NativePush\NativePushSender;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Client\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;

/** A throwaway service-account file and .p8 key, and the public halves to check signatures with. */
function pushKeys(): array
{
    static $keys = null;

    if ($keys !== null) {
        return $keys;
    }

    $rsa = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    openssl_pkey_export($rsa, $rsaPem);
    $ec = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    openssl_pkey_export($ec, $ecPem);

    $dir = sys_get_temp_dir().'/native-push-test-'.getmypid();
    @mkdir($dir);
    file_put_contents("{$dir}/service-account.json", json_encode([
        'type' => 'service_account',
        'project_id' => 'kanyaw-test',
        'client_email' => 'push@kanyaw-test.iam.gserviceaccount.com',
        'private_key' => $rsaPem,
        'token_uri' => 'https://oauth2.googleapis.com/token',
    ]));
    file_put_contents("{$dir}/AuthKey_ABC123DEFG.p8", $ecPem);

    return $keys = [
        'fcm' => "{$dir}/service-account.json",
        'apns' => "{$dir}/AuthKey_ABC123DEFG.p8",
        'rsa_public' => openssl_pkey_get_details($rsa)['key'],
        'ec_public' => openssl_pkey_get_details($ec)['key'],
    ];
}

function sender(array $apns = []): HttpNativePushSender
{
    $keys = pushKeys();

    return new HttpNativePushSender(
        ['credentials' => $keys['fcm'], 'project_id' => null],
        array_merge(['key_path' => $keys['apns'], 'key_id' => 'ABC123DEFG', 'team_id' => 'TEAM123456', 'bundle_id' => 'org.example.kanyawconnect', 'production' => false], $apns),
        5,
    );
}

const FCM_TOKEN = 'fcm-device-token-1234567890';
const APNS_TOKEN = '00fc13adff785122b4ad28809a3420982341241421348097878e577c991de8f0';

function fakeGoogle(array $sendResponse = ['name' => 'projects/kanyaw-test/messages/1'], int $status = 200): void
{
    Http::fake([
        'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.test-access-token', 'expires_in' => 3599, 'token_type' => 'Bearer']),
        'fcm.googleapis.com/*' => Http::response($sendResponse, $status),
    ]);
}

beforeEach(fn () => Cache::flush());

describe('FCM HTTP v1', function () {
    it('signs in with the service account, then sends the message to the project', function () {
        fakeGoogle();

        $outcome = sender()->send(new FcmMessage(FCM_TOKEN, ['type' => 'message.new', 'chat_id' => 'c1'], ['title' => 'Naw Paw', 'body' => 'Hello'], 'messages', true, 86400));

        expect($outcome)->toBe(PushOutcome::Sent);

        Http::assertSent(function (Request $request) {
            if ($request->url() !== 'https://oauth2.googleapis.com/token') {
                return false;
            }
            $claims = (array) JWT::decode($request['assertion'], new Key(pushKeys()['rsa_public'], 'RS256'));

            return $request['grant_type'] === 'urn:ietf:params:oauth:grant-type:jwt-bearer'
                && $claims['iss'] === 'push@kanyaw-test.iam.gserviceaccount.com'
                && $claims['scope'] === 'https://www.googleapis.com/auth/firebase.messaging'
                && $claims['aud'] === 'https://oauth2.googleapis.com/token';
        });

        Http::assertSent(fn (Request $request) => $request->url() === 'https://fcm.googleapis.com/v1/projects/kanyaw-test/messages:send'
            && $request->hasHeader('Authorization', 'Bearer ya29.test-access-token')
            && $request->data() === ['message' => [
                'token' => FCM_TOKEN,
                'notification' => ['title' => 'Naw Paw', 'body' => 'Hello'],
                'data' => ['type' => 'message.new', 'chat_id' => 'c1'],
                'android' => ['priority' => 'HIGH', 'ttl' => '86400s', 'notification' => ['channel_id' => 'messages']],
            ]]);
    });

    it('sends a data-only message with high priority and a TTL for calls', function () {
        fakeGoogle();

        sender()->send(new FcmMessage(FCM_TOKEN, FcmMessage::stringify(['type' => 'call.incoming', 'call_id' => 'k1', 'video' => true]), highPriority: true, ttlSeconds: 27));

        Http::assertSent(fn (Request $request) => str_contains($request->url(), 'messages:send')
            && $request->data()['message'] === [
                'token' => FCM_TOKEN,
                'data' => ['type' => 'call.incoming', 'call_id' => 'k1', 'video' => 'true'],
                'android' => ['priority' => 'HIGH', 'ttl' => '27s'],
            ]);
    });

    it('reuses the access token until it is close to expiring', function () {
        fakeGoogle();

        sender()->send(new FcmMessage(FCM_TOKEN, ['a' => 'b']));
        sender()->send(new FcmMessage(FCM_TOKEN, ['a' => 'b']));

        expect(collect(Http::recorded())->filter(fn ($pair) => str_contains($pair[0]->url(), 'oauth2'))->count())->toBe(1);
    });

    it('reports a token FCM no longer knows as expired', function (array $body, int $status) {
        fakeGoogle($body, $status);

        expect(sender()->send(new FcmMessage(FCM_TOKEN, ['a' => 'b'])))->toBe(PushOutcome::Expired);
    })->with([
        'UNREGISTERED' => [['error' => ['code' => 404, 'status' => 'NOT_FOUND', 'details' => [['@type' => 'type.googleapis.com/google.firebase.fcm.v1.FcmError', 'errorCode' => 'UNREGISTERED']]]], 404],
        'malformed token' => [['error' => ['code' => 400, 'status' => 'INVALID_ARGUMENT', 'message' => 'The registration token is not a valid FCM registration token', 'details' => [
            ['@type' => 'type.googleapis.com/google.firebase.fcm.v1.FcmError', 'errorCode' => 'INVALID_ARGUMENT'],
            ['@type' => 'type.googleapis.com/google.rpc.BadRequest', 'fieldViolations' => [['field' => 'message.token', 'description' => 'Invalid registration token']]],
        ]]], 400],
    ]);

    it('treats other errors as temporary, and keeps the token', function (array $body, int $status) {
        fakeGoogle($body, $status);

        expect(sender()->send(new FcmMessage(FCM_TOKEN, ['a' => 'b'])))->toBe(PushOutcome::Failed);
    })->with([
        'bad TTL' => [['error' => ['status' => 'INVALID_ARGUMENT', 'message' => 'Invalid value at message.android.ttl', 'details' => [
            ['@type' => 'type.googleapis.com/google.rpc.BadRequest', 'fieldViolations' => [['field' => 'message.android.ttl']]],
        ]]], 400],
        'quota' => [['error' => ['status' => 'RESOURCE_EXHAUSTED', 'details' => [['errorCode' => 'QUOTA_EXCEEDED']]]], 429],
        'unavailable' => [['error' => ['status' => 'UNAVAILABLE']], 503],
        'internal' => [['error' => ['status' => 'INTERNAL']], 500],
    ]);

    it('drops a refused access token so the next send signs in again', function () {
        fakeGoogle(['error' => ['status' => 'UNAUTHENTICATED']], 401);

        expect(sender()->send(new FcmMessage(FCM_TOKEN, ['a' => 'b'])))->toBe(PushOutcome::Failed);
        sender()->send(new FcmMessage(FCM_TOKEN, ['a' => 'b']));

        expect(collect(Http::recorded())->filter(fn ($pair) => str_contains($pair[0]->url(), 'oauth2'))->count())->toBe(2);
    });
});

describe('APNs', function () {
    it('sends an alert with the right headers and a signed provider token, over HTTP/2', function () {
        Http::fake(['api.sandbox.push.apple.com/*' => Http::response('', 200, ['apns-id' => 'eabeae54-14a8-11e5-b60b-1697f925ec7b'])]);
        $payload = ['aps' => ['alert' => ['title' => 'Naw Paw', 'body' => 'Hello'], 'sound' => 'default'], 'type' => 'message.new'];

        $outcome = sender()->send(new ApnsMessage(APNS_TOKEN, ApnsMessage::ALERT, 'org.example.kanyawconnect', 10, 1_900_000_000, $payload));

        expect($outcome)->toBe(PushOutcome::Sent);

        Http::assertSent(function (Request $request) use ($payload) {
            [$jwt] = sscanf($request->header('authorization')[0], 'bearer %s');
            $header = json_decode(base64_decode(strtr(explode('.', $jwt)[0], '-_', '+/')), true);
            $claims = (array) JWT::decode($jwt, new Key(pushKeys()['ec_public'], 'ES256'));

            return $request->url() === 'https://api.sandbox.push.apple.com/3/device/'.APNS_TOKEN
                && $request->toPsrRequest()->getProtocolVersion() === '2.0'
                && $request->header('apns-push-type') === ['alert']
                && $request->header('apns-topic') === ['org.example.kanyawconnect']
                && $request->header('apns-priority') === ['10']
                && $request->header('apns-expiration') === ['1900000000']
                && $header === ['typ' => 'JWT', 'alg' => 'ES256', 'kid' => 'ABC123DEFG']
                && $claims['iss'] === 'TEAM123456'
                && abs($claims['iat'] - time()) < 5
                && json_decode($request->body(), true) === $payload;
        });
    });

    it('sends a VoIP push to the .voip topic, and uses the production server when asked', function () {
        Http::fake(['api.push.apple.com/*' => Http::response('', 200)]);

        sender(['production' => true])->send(new ApnsMessage(APNS_TOKEN, ApnsMessage::VOIP, 'org.example.kanyawconnect.voip', 10, 1_900_000_030, ['type' => 'call.incoming']));

        Http::assertSent(fn (Request $request) => $request->url() === 'https://api.push.apple.com/3/device/'.APNS_TOKEN
            && $request->header('apns-push-type') === ['voip']
            && $request->header('apns-topic') === ['org.example.kanyawconnect.voip']);
    });

    it('keeps the provider token for many requests (Apple refuses one renewed more than every 20 minutes)', function () {
        Http::fake(['api.sandbox.push.apple.com/*' => Http::response('', 200)]);

        sender()->send(new ApnsMessage(APNS_TOKEN, 'alert', 't', 10, 0, ['aps' => []]));
        $this->travel(19)->minutes();
        sender()->send(new ApnsMessage(APNS_TOKEN, 'alert', 't', 10, 0, ['aps' => []]));

        $tokens = collect(Http::recorded())->map(fn ($pair) => $pair[0]->header('authorization')[0])->unique();
        expect($tokens)->toHaveCount(1);
    });

    it('reports a dead device token as expired', function (int $status, string $reason) {
        Http::fake(['api.sandbox.push.apple.com/*' => Http::response(['reason' => $reason], $status)]);

        expect(sender()->send(new ApnsMessage(APNS_TOKEN, 'alert', 't', 10, 0, ['aps' => []])))->toBe(PushOutcome::Expired);
    })->with([
        'Unregistered' => [410, 'Unregistered'],
        'ExpiredToken' => [410, 'ExpiredToken'],
        'BadDeviceToken' => [400, 'BadDeviceToken'],
        'DeviceTokenNotForTopic' => [400, 'DeviceTokenNotForTopic'],
    ]);

    it('treats other answers as temporary', function (int $status, string $reason) {
        Http::fake(['api.sandbox.push.apple.com/*' => Http::response(['reason' => $reason], $status)]);

        expect(sender()->send(new ApnsMessage(APNS_TOKEN, 'alert', 't', 10, 0, ['aps' => []])))->toBe(PushOutcome::Failed);
    })->with([
        'TooManyRequests' => [429, 'TooManyRequests'],
        'InternalServerError' => [500, 'InternalServerError'],
        'ServiceUnavailable' => [503, 'ServiceUnavailable'],
        'BadTopic' => [400, 'BadTopic'],
    ]);

    it('makes a new provider token after APNs calls the old one expired', function () {
        Http::fakeSequence('api.sandbox.push.apple.com/*')->push(['reason' => 'ExpiredProviderToken'], 403)->push('', 200);

        expect(sender()->send(new ApnsMessage(APNS_TOKEN, 'alert', 't', 10, 0, ['aps' => []])))->toBe(PushOutcome::Failed);
        $this->travel(1)->seconds();
        expect(sender()->send(new ApnsMessage(APNS_TOKEN, 'alert', 't', 10, 0, ['aps' => []])))->toBe(PushOutcome::Sent);

        $tokens = collect(Http::recorded())->map(fn ($pair) => $pair[0]->header('authorization')[0])->unique();
        expect($tokens)->toHaveCount(2);
    });
});

describe('without credentials', function () {
    it('says each platform is off until its keys are set, and sends nothing', function () {
        Http::fake();
        $sender = new HttpNativePushSender(['credentials' => null], ['key_path' => null, 'key_id' => null, 'team_id' => null, 'bundle_id' => 'b'], 5);

        expect($sender->isConfigured(PushPlatform::Android))->toBeFalse()
            ->and($sender->isConfigured(PushPlatform::Ios))->toBeFalse()
            ->and($sender->send(new FcmMessage(FCM_TOKEN, ['a' => 'b'])))->toBe(PushOutcome::Failed);

        Http::assertNothingSent();
    });

    it('says a platform is on once its keys are readable', function () {
        expect(sender()->isConfigured(PushPlatform::Android))->toBeTrue()
            ->and(sender()->isConfigured(PushPlatform::Ios))->toBeTrue();
    });

    it('finds key files given relative to the project, as the README suggests', function () {
        $dir = 'storage/framework/testing/native-push-'.getmypid();
        @mkdir(base_path($dir), 0777, true);
        copy(pushKeys()['fcm'], base_path("{$dir}/firebase.json"));
        copy(pushKeys()['apns'], base_path("{$dir}/AuthKey.p8"));
        config([
            'push.native.fcm.credentials' => "{$dir}/firebase.json",
            'push.native.apns' => ['key_path' => "{$dir}/AuthKey.p8", 'key_id' => 'ABC123DEFG', 'team_id' => 'TEAM123456'] + config('push.native.apns'),
        ]);
        app()->forgetInstance(NativePushSender::class);

        try {
            expect(app(NativePushSender::class)->isConfigured(PushPlatform::Android))->toBeTrue()
                ->and(app(NativePushSender::class)->isConfigured(PushPlatform::Ios))->toBeTrue();
        } finally {
            array_map('unlink', glob(base_path("{$dir}/*")));
            rmdir(base_path($dir));
        }
    });
});

it('never writes a device token or a message body to the log', function () {
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged) {
        $logged[] = $event->message.' '.json_encode($event->context);
    });
    Http::fake([
        'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.x', 'expires_in' => 3599]),
        'fcm.googleapis.com/*' => Http::response(['error' => ['status' => 'NOT_FOUND', 'details' => [['errorCode' => 'UNREGISTERED']]]], 404),
        'api.sandbox.push.apple.com/*' => Http::response(['reason' => 'BadTopic'], 400),
    ]);

    sender()->send(new FcmMessage(FCM_TOKEN, ['text' => 'secret words'], ['title' => 'Naw Paw', 'body' => 'secret words']));
    sender()->send(new ApnsMessage(APNS_TOKEN, 'alert', 't', 10, 0, ['aps' => ['alert' => 'secret words']]));

    expect($logged)->not->toBeEmpty();
    foreach ($logged as $line) {
        expect($line)->not->toContain(FCM_TOKEN)->not->toContain(APNS_TOKEN)->not->toContain('secret words');
    }
});

it('logs which field FCM objected to, but never a value', function () {
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged) {
        $logged[] = $event->context;
    });
    Http::fake([
        'oauth2.googleapis.com/*' => Http::response(['access_token' => 'ya29.x', 'expires_in' => 3599]),
        'fcm.googleapis.com/*' => Http::response(['error' => ['code' => 400, 'status' => 'INVALID_ARGUMENT', 'details' => [
            ['@type' => 'type.googleapis.com/google.rpc.BadRequest', 'fieldViolations' => [
                ['field' => 'message.data', 'description' => 'Invalid data payload key: secret words'],
                ['field' => 'message.data[secret words]'],
            ]],
        ]]], 400),
    ]);

    expect(sender()->send(new FcmMessage(FCM_TOKEN, ['kind' => 'text'])))->toBe(PushOutcome::Failed);

    expect($logged)->toHaveCount(1)
        ->and($logged[0])->toMatchArray(['reason' => 'INVALID_ARGUMENT', 'fields' => ['message.data']])
        ->and(json_encode($logged[0]))->not->toContain('secret words');
});

describe('data keys', function () {
    it('refuses the keys FCM keeps for itself, so such a message is never sent', function (string $key) {
        expect(fn () => new FcmMessage(FCM_TOKEN, [$key => 'x']))->toThrow(InvalidArgumentException::class);
    })->with(['from', 'message_type', 'google.sent_time', 'gcm.notification.title', 'Google_x']);

    it('accepts ordinary keys', function () {
        expect((new FcmMessage(FCM_TOKEN, ['type' => 'message.new', 'message_kind' => 'text', 'chat_id' => 'c']))->data)
            ->toHaveKey('message_kind');
    });
});
