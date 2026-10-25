<?php

namespace App\Providers;

use App\Services\LiveKitService;
use App\Services\WebPushService;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(LiveKitService::class, fn () => new LiveKitService(config('services.livekit')));

        $this->app->singleton(WebPushService::class, fn () => new WebPushService(
            config('push.vapid'),
            config('push.ttl_seconds'),
            config('push.urgency'),
            config('push.timeout_seconds'),
        ));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Password::defaults(fn () => Password::min(8));

        $this->trustProxies();
        $this->configureRateLimiting();
    }

    /**
     * Believe X-Forwarded-* headers from the configured proxies (see config/security.php).
     */
    private function trustProxies(): void
    {
        $proxies = config('security.trusted_proxies');

        if ($proxies) {
            TrustProxies::at(in_array($proxies, ['*', '**'], true) ? $proxies : array_map('trim', explode(',', $proxies)));
        }
    }

    private function configureRateLimiting(): void
    {
        // Account creation is open, so cap it per IP address. Generous, because many people on a mobile
        // network can share one address.
        RateLimiter::for('register', fn (Request $request) => Limit::perHour(config('security.register_rate_limit_per_hour'))->by($request->ip()));

        // Backstop against floods from one signed-in client; the per-action limiters below are stricter.
        RateLimiter::for('api-general', fn (Request $request) => Limit::perMinute(config('security.api_rate_limit_per_minute'))->by($request->user()?->id ?: $request->ip()));

        // 5 attempts per minute per email + IP combination.
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute(5)->by(
            Str::lower((string) $request->input('email')).'|'.$request->ip()
        ));

        // Asking for a reset link and using one: per IP address (the broker also allows one link per
        // address per minute). Both work signed out.
        RateLimiter::for('password-reset', fn (Request $request) => Limit::perMinute(5)->by($request->ip()));

        // The current password guards the change, so it must not be guessable with a stolen token.
        RateLimiter::for('password-change', fn (Request $request) => Limit::perMinute(5)->by($request->user()?->id ?: $request->ip()));

        // Each new verification email is a real email: a few an hour is plenty.
        RateLimiter::for('verification-email', fn (Request $request) => Limit::perHour(6)->by($request->user()?->id ?: $request->ip()));

        // The verification link works signed out, so it is limited per address.
        RateLimiter::for('email-verify', fn (Request $request) => Limit::perMinute(20)->by($request->ip()));

        // Clients ping every 30-60 s; this leaves room for a few devices per user.
        RateLimiter::for('heartbeat', fn (Request $request) => Limit::perMinute(12)->by($request->user()?->id ?: $request->ip()));

        // Guards the room password against guessing: per person, per room.
        RateLimiter::for('room-join', function (Request $request) {
            // Throttling runs before route-model binding, so this is usually still the raw id.
            $room = $request->route('room');
            $roomId = $room instanceof Model ? $room->getKey() : $room;

            return Limit::perMinute(20)->by(($request->user()?->id ?: $request->ip()).'|'.$roomId);
        });

        // Registering a device is rare. Together with the per-user device cap this bounds how much
        // key material one account can park on the server.
        RateLimiter::for('devices', fn (Request $request) => Limit::perHour(20)->by($request->user()?->id ?: $request->ip()));

        // A browser subscribes once; this only stops a script from filling the table.
        RateLimiter::for('push-subscriptions', fn (Request $request) => Limit::perHour(30)->by($request->user()?->id ?: $request->ip()));

        // Every key-bundle fetch uses up one-time prekeys, so it is limited per requester per target
        // to stop anyone draining a person's prekeys. Runs before route-model binding: the user is an id.
        RateLimiter::for('key-bundles', function (Request $request) {
            $target = $request->route('user');
            $targetId = $target instanceof Model ? $target->getKey() : $target;

            return Limit::perMinute(10)->by(($request->user()?->id ?: $request->ip()).'|'.$targetId);
        });

        // 30 messages per minute per user, across all chats.
        RateLimiter::for('messages', fn (Request $request) => Limit::perMinute(30)->by($request->user()?->id ?: $request->ip()));

        // Starting calls: enough to redial a few times, not enough to ring someone's phone non-stop.
        RateLimiter::for('calls', fn (Request $request) => Limit::perMinute(10)->by($request->user()?->id ?: $request->ip()));

        // The signed decline link works without a bearer token, so it is limited per address too.
        RateLimiter::for('call-answers', fn (Request $request) => Limit::perMinute(30)->by($request->ip()));
    }
}
