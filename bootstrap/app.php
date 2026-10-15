<?php

use App\Exceptions\EncryptionConflictException;
use App\Exceptions\LiveKitException;
use App\Exceptions\RoomConflictException;
use App\Http\Middleware\KeepEnvelopesUntouched;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Foundation\Http\Middleware\ConvertEmptyStringsToNull;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    // Channel authorization endpoint: POST /api/v1/broadcasting/auth, authenticated by Sanctum bearer token.
    ->withBroadcasting(__DIR__.'/../routes/channels.php', [
        'prefix' => 'api/v1',
        'middleware' => ['auth:sanctum'],
    ])
    ->withMiddleware(function (Middleware $middleware): void {
        // Encrypted envelopes are opaque and must be stored exactly as sent: no trimming and no
        // empty-string-to-null conversion for anything under `envelopes`.
        $middleware->trimStrings(except: ['envelopes.*']);
        $middleware->replace(ConvertEmptyStringsToNull::class, KeepEnvelopesUntouched::class);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(fn (LiveKitException $e) => response()->json(['message' => $e->getMessage()], 503));
        $exceptions->render(fn (EncryptionConflictException $e) => response()->json(['message' => $e->getMessage(), 'code' => $e->errorCode] + $e->extra, $e->status));
        $exceptions->render(fn (RoomConflictException $e) => response()->json(['message' => $e->getMessage(), 'code' => $e->errorCode], $e->status));

        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
