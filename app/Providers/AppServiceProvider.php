<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
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
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Password::defaults(fn () => Password::min(8));

        $this->configureRateLimiting();
    }

    private function configureRateLimiting(): void
    {
        // 5 attempts per minute per email + IP combination.
        RateLimiter::for('login', fn (Request $request) => Limit::perMinute(5)->by(
            Str::lower((string) $request->input('email')).'|'.$request->ip()
        ));

        // Clients ping every 30-60 s; this leaves room for a few devices per user.
        RateLimiter::for('heartbeat', fn (Request $request) => Limit::perMinute(12)->by($request->user()?->id ?: $request->ip()));

        // 30 messages per minute per user, across all chats.
        RateLimiter::for('messages', fn (Request $request) => Limit::perMinute(30)->by($request->user()?->id ?: $request->ip()));
    }
}
