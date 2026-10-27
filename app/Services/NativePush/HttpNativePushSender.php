<?php

namespace App\Services\NativePush;

use App\Enums\PushOutcome;
use App\Enums\PushPlatform;
use Firebase\JWT\JWT;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * Talks to FCM HTTP v1 and APNs directly over HTTPS, without an SDK.
 *
 * - FCM: a service-account key signs a JWT (RS256), exchanged at Google for an OAuth access token
 *   (scope firebase.messaging) that is cached until shortly before it expires.
 * - APNs: the .p8 key signs a provider token (ES256, kid + iss + iat), cached for 50 minutes: Apple
 *   wants it renewed at most every 20 and at least every 60 minutes. Requests use HTTP/2.
 *
 * Logs name the platform, status and the service's reason code, never a device token or a body.
 */
class HttpNativePushSender implements NativePushSender
{
    private const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

    private const APNS_TOKEN_MINUTES = 50;

    /**
     * @param  array{credentials?: string|null, project_id?: string|null}  $fcm
     * @param  array{key_path?: string|null, key_id?: string|null, team_id?: string|null, bundle_id: string, production?: bool}  $apns
     */
    public function __construct(private array $fcm, private array $apns, private int $timeout) {}

    public function isConfigured(PushPlatform $platform): bool
    {
        return match ($platform) {
            PushPlatform::Android => filled($this->fcm['credentials'] ?? null) && is_readable((string) $this->fcm['credentials']),
            PushPlatform::Ios => filled($this->apns['key_id'] ?? null) && filled($this->apns['team_id'] ?? null)
                && filled($this->apns['key_path'] ?? null) && is_readable((string) $this->apns['key_path']),
        };
    }

    public function apnsTopic(): string
    {
        return $this->apns['bundle_id'];
    }

    public function send(FcmMessage|ApnsMessage $message): PushOutcome
    {
        $platform = $message instanceof FcmMessage ? PushPlatform::Android : PushPlatform::Ios;

        if (! $this->isConfigured($platform)) {
            return PushOutcome::Failed;
        }

        try {
            return $message instanceof FcmMessage ? $this->sendFcm($message) : $this->sendApns($message);
        } catch (ConnectionException) {
            Log::warning('Native push: the push service could not be reached.', ['platform' => $platform->value]);
        } catch (Throwable $e) {
            Log::warning('Native push: sending failed.', ['platform' => $platform->value, 'error' => $e::class]);
        }

        return PushOutcome::Failed;
    }

    /* ------------------------------------------------------------------------------------- FCM --- */

    private function sendFcm(FcmMessage $message): PushOutcome
    {
        $account = $this->serviceAccount();
        $project = $this->fcm['project_id'] ?? null ?: $account['project_id'];

        $response = Http::timeout($this->timeout)
            ->withToken($this->fcmAccessToken($account))
            ->acceptJson()
            ->post("https://fcm.googleapis.com/v1/projects/{$project}/messages:send", ['message' => $message->toArray()]);

        if ($response->successful()) {
            return PushOutcome::Sent;
        }

        $code = $this->fcmErrorCode($response);

        if ($response->status() === 401) {
            // The cached access token was refused (revoked key, clock skew): get a new one next time.
            Cache::forget($this->fcmCacheKey($account));
        }

        $dead = $code === 'UNREGISTERED' || ($code === 'INVALID_ARGUMENT' && $this->fcmTokenRejected($response));

        // Which part of the request FCM objected to (a field path such as "message.data"): never a value.
        Log::log($dead ? 'info' : 'warning', 'Native push: FCM did not accept a message.', array_filter([
            'platform' => 'android', 'status' => $response->status(), 'reason' => $code,
            'fields' => $this->fcmFieldViolations($response) ?: null,
        ]));

        return $dead ? PushOutcome::Expired : PushOutcome::Failed;
    }

    /** @return array{client_email: string, private_key: string, project_id: string, token_uri?: string} */
    private function serviceAccount(): array
    {
        $account = json_decode((string) file_get_contents((string) $this->fcm['credentials']), true);

        if (! is_array($account) || ! isset($account['client_email'], $account['private_key'], $account['project_id'])) {
            throw new RuntimeException('The FCM service-account file is not a service-account key.');
        }

        return $account;
    }

    /** @param  array{client_email: string, private_key: string, token_uri?: string}  $account */
    private function fcmAccessToken(array $account): string
    {
        $cached = Cache::get($this->fcmCacheKey($account));

        if (is_string($cached)) {
            return $cached;
        }

        $tokenUri = $account['token_uri'] ?? 'https://oauth2.googleapis.com/token';
        $now = time();
        $assertion = JWT::encode([
            'iss' => $account['client_email'],
            'scope' => self::FCM_SCOPE,
            'aud' => $tokenUri,
            'iat' => $now,
            'exp' => $now + 3600,
        ], $account['private_key'], 'RS256');

        $response = Http::timeout($this->timeout)->asForm()->post($tokenUri, [
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion' => $assertion,
        ])->throw();

        $token = (string) $response->json('access_token');
        $lifetime = (int) ($response->json('expires_in') ?? 3600);
        Cache::put($this->fcmCacheKey($account), $token, now()->addSeconds(max(60, $lifetime - 300)));

        return $token;
    }

    private function fcmCacheKey(array $account): string
    {
        return 'native-push:fcm-access-token:'.sha1($account['client_email']);
    }

    /** FCM's own error code (UNREGISTERED, INVALID_ARGUMENT, ...) from the error details, else the status name. */
    private function fcmErrorCode(Response $response): ?string
    {
        foreach ((array) $response->json('error.details', []) as $detail) {
            if (is_array($detail) && isset($detail['errorCode'])) {
                return (string) $detail['errorCode'];
            }
        }

        return $response->json('error.status');
    }

    /** INVALID_ARGUMENT can mean many things; only a rejected registration token means the token is dead. */
    private function fcmTokenRejected(Response $response): bool
    {
        if (in_array('message.token', $this->fcmFieldViolations($response), true)) {
            return true;
        }

        return str_contains((string) $response->json('error.message'), 'registration token');
    }

    /**
     * The field paths in FCM's error details. Only paths made of letters, dots and brackets are kept, so
     * nothing a client sent can reach the log through here.
     *
     * @return list<string>
     */
    private function fcmFieldViolations(Response $response): array
    {
        $fields = [];
        foreach ((array) $response->json('error.details', []) as $detail) {
            foreach ((array) ($detail['fieldViolations'] ?? []) as $violation) {
                $field = $violation['field'] ?? null;
                if (is_string($field) && preg_match('/^[A-Za-z0-9_.\[\]]{1,100}$/', $field)) {
                    $fields[] = $field;
                }
            }
        }

        return $fields;
    }

    /* ------------------------------------------------------------------------------------ APNs --- */

    private function sendApns(ApnsMessage $message): PushOutcome
    {
        $host = ($this->apns['production'] ?? false) ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';

        $response = Http::timeout($this->timeout)
            ->withOptions(['version' => 2.0])
            ->withHeaders(['authorization' => 'bearer '.$this->apnsProviderToken()] + $message->headers())
            ->withBody(json_encode($message->payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'application/json')
            ->post("{$host}/3/device/{$message->deviceToken}");

        if ($response->status() === 200) {
            return PushOutcome::Sent;
        }

        $reason = $response->json('reason');

        if (in_array($reason, ['ExpiredProviderToken', 'InvalidProviderToken'], true)) {
            Cache::forget($this->apnsCacheKey());
        }

        $dead = $response->status() === 410 || in_array($reason, ['BadDeviceToken', 'DeviceTokenNotForTopic'], true);

        Log::log($dead ? 'info' : 'warning', 'Native push: APNs did not accept a notification.', [
            'platform' => 'ios', 'push_type' => $message->pushType, 'status' => $response->status(), 'reason' => $reason,
        ]);

        return $dead ? PushOutcome::Expired : PushOutcome::Failed;
    }

    private function apnsProviderToken(): string
    {
        return Cache::remember($this->apnsCacheKey(), now()->addMinutes(self::APNS_TOKEN_MINUTES), fn () => JWT::encode(
            ['iss' => $this->apns['team_id'], 'iat' => time()],
            (string) file_get_contents((string) $this->apns['key_path']),
            'ES256',
            $this->apns['key_id'],
        ));
    }

    private function apnsCacheKey(): string
    {
        return 'native-push:apns-provider-token:'.$this->apns['key_id'];
    }
}
