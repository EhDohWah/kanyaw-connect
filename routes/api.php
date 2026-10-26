<?php

use App\Http\Controllers\Api\V1\AttachmentController;
use App\Http\Controllers\Api\V1\AttachmentFileController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\CallController;
use App\Http\Controllers\Api\V1\ChatController;
use App\Http\Controllers\Api\V1\ChatMemberController;
use App\Http\Controllers\Api\V1\ChatReadController;
use App\Http\Controllers\Api\V1\DeviceController;
use App\Http\Controllers\Api\V1\EmailVerificationController;
use App\Http\Controllers\Api\V1\KeyBundleController;
use App\Http\Controllers\Api\V1\LiveKitWebhookController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\MessageController;
use App\Http\Controllers\Api\V1\NativePushTokenController;
use App\Http\Controllers\Api\V1\PasswordController;
use App\Http\Controllers\Api\V1\PresenceController;
use App\Http\Controllers\Api\V1\PushSubscriptionController;
use App\Http\Controllers\Api\V1\RoomAuditLogController;
use App\Http\Controllers\Api\V1\RoomController;
use App\Http\Controllers\Api\V1\RoomLifecycleController;
use App\Http\Controllers\Api\V1\RoomParticipantController;
use Illuminate\Support\Facades\Route;

// All routes below are served under /api/v1 (the /api prefix comes from bootstrap/app.php).
Route::prefix('v1')->group(function () {
    Route::prefix('auth')->group(function () {
        Route::post('register', [AuthController::class, 'register'])->middleware('throttle:register');
        Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login');
        Route::post('logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');

        // Forgotten password: the emailed link opens the app, which sends the token back here.
        Route::post('forgot-password', [PasswordController::class, 'forgot'])->middleware('throttle:password-reset');
        Route::post('reset-password', [PasswordController::class, 'reset'])->middleware('throttle:password-reset');

        // Email verification. The link in the email is signed (for the path alone, so the host does not
        // matter) and works signed out, on any device.
        Route::post('email/verify/{id}/{hash}', [EmailVerificationController::class, 'verify'])
            ->name('verification.verify')
            ->middleware(['signed:relative', 'throttle:email-verify']);
        Route::post('email/verification-notification', [EmailVerificationController::class, 'send'])
            ->middleware(['auth:sanctum', 'throttle:verification-email']);
    });

    // Attachment bytes: authorised by the signature on the URL, not by a bearer token.
    Route::middleware('signed')->group(function () {
        Route::get('attachments/{attachment}/file', [AttachmentFileController::class, 'file'])->name('attachments.file');
        Route::get('attachments/{attachment}/thumbnail', [AttachmentFileController::class, 'thumbnail'])->name('attachments.thumbnail');
    });

    // Declining a call: by the callee with a bearer token, or by the service worker with the signed
    // decline_url from the incoming-call push (it has no token). The controller checks which.
    Route::post('calls/{call}/decline', [CallController::class, 'decline'])->name('calls.decline')->middleware('throttle:call-answers');

    // Called by the LiveKit server, not by clients: authorised by the signature on the request.
    Route::post('webhooks/livekit', LiveKitWebhookController::class);

    Route::middleware(['auth:sanctum', 'throttle:api-general'])->group(function () {
        Route::get('me', [MeController::class, 'show']);
        Route::patch('me', [MeController::class, 'update']);
        Route::post('me/avatar', [MeController::class, 'avatar']);
        // The password guards it, so it shares the password-change limit (5 a minute).
        Route::delete('me', [MeController::class, 'destroy'])->middleware('throttle:password-change');
        Route::put('me/password', [PasswordController::class, 'update'])->middleware('throttle:password-change');
        Route::post('me/heartbeat', [PresenceController::class, 'heartbeat'])->middleware('throttle:heartbeat');
        Route::get('users/presence', [PresenceController::class, 'index']);

        Route::get('chats', [ChatController::class, 'index']);
        Route::post('chats/direct', [ChatController::class, 'storeDirect']);
        Route::post('chats/group', [ChatController::class, 'storeGroup']);

        // Everything under /chats/{chat} is members-only; the middleware runs before validation,
        // so non-members get 403 whatever they send.
        Route::prefix('chats/{chat}')->middleware('can:view,chat')->group(function () {
            Route::get('/', [ChatController::class, 'show']);
            Route::patch('/', [ChatController::class, 'update'])->middleware('can:update,chat');
            Route::delete('leave', [ChatController::class, 'leave'])->middleware('can:leave,chat');

            Route::post('members', [ChatMemberController::class, 'store'])->middleware('can:addMembers,chat');
            Route::patch('members/{user}', [ChatMemberController::class, 'update'])->middleware('can:changeRole,chat,user');
            Route::delete('members/{user}', [ChatMemberController::class, 'destroy'])->middleware('can:removeMember,chat,user');

            Route::get('messages', [MessageController::class, 'index']);
            Route::post('messages', [MessageController::class, 'store'])->middleware('throttle:messages');
            Route::post('read', [ChatReadController::class, 'store']);
            Route::post('attachments', [AttachmentController::class, 'store']);
            Route::post('calls', [CallController::class, 'store'])->middleware(['can:call,chat', 'throttle:calls']);
        });

        // One-to-one calls. Only the two people in a call can see it (others get 404).
        Route::get('calls/current', [CallController::class, 'current']);
        Route::get('calls/{call}', [CallController::class, 'show'])->middleware('can:view,call');
        Route::post('calls/{call}/accept', [CallController::class, 'accept'])->middleware('can:answer,call');
        Route::post('calls/{call}/cancel', [CallController::class, 'cancel'])->middleware('can:cancel,call');
        Route::post('calls/{call}/end', [CallController::class, 'end'])->middleware('can:end,call');

        // End-to-end encryption: the server is a key directory. Only public keys are ever sent here.
        Route::get('devices', [DeviceController::class, 'index']);
        Route::post('devices', [DeviceController::class, 'store'])->middleware('throttle:devices');
        Route::delete('devices/{device}', [DeviceController::class, 'destroy'])->middleware('can:manage,device');
        Route::put('devices/{device}/signed-prekey', [DeviceController::class, 'rotateSignedPrekey'])->middleware('can:manage,device');
        Route::post('devices/{device}/prekeys', [DeviceController::class, 'uploadPrekeys'])->middleware('can:manage,device');
        Route::get('devices/{device}/prekeys/count', [DeviceController::class, 'prekeyCount'])->middleware('can:manage,device');
        Route::get('users/{user}/key-bundles', [KeyBundleController::class, 'index'])
            ->middleware(['throttle:key-bundles', 'can:fetchKeyBundles,user']);

        // Web push: the browser registers its subscription so it is notified while the app is closed.
        Route::get('push/public-key', [PushSubscriptionController::class, 'publicKey']);
        Route::get('push/subscriptions', [PushSubscriptionController::class, 'index']);
        Route::post('push/subscriptions', [PushSubscriptionController::class, 'store'])->middleware('throttle:push-subscriptions');
        Route::delete('push/subscriptions/{subscription}', [PushSubscriptionController::class, 'destroy'])->middleware('can:manage,subscription');

        // Native push: the phone app registers its FCM or APNs token (and PushKit token on iOS).
        Route::post('push/native-tokens', [NativePushTokenController::class, 'store'])->middleware('throttle:native-push-tokens');
        Route::delete('push/native-tokens/{token}', [NativePushTokenController::class, 'destroy'])->middleware('can:manage,token');

        Route::get('rooms', [RoomController::class, 'index']);
        Route::post('rooms', [RoomController::class, 'store']);

        // Everything under /rooms/{room} needs permission to see the room; the middleware runs before
        // validation, so people who may not see it get 403 whatever they send.
        Route::prefix('rooms/{room}')->middleware('can:view,room')->group(function () {
            Route::get('/', [RoomController::class, 'show']);
            Route::post('join', [RoomController::class, 'join'])->middleware(['can:join,room', 'throttle:room-join']);

            Route::post('admit/{user}', [RoomParticipantController::class, 'admit'])->middleware('can:manage,room');
            Route::post('deny/{user}', [RoomParticipantController::class, 'deny'])->middleware('can:manage,room');
            Route::post('participants/{user}/remove', [RoomParticipantController::class, 'remove'])->middleware('can:moderate,room,user');
            Route::post('participants/{user}/mute', [RoomParticipantController::class, 'mute'])->middleware('can:moderate,room,user');

            Route::post('lock', [RoomLifecycleController::class, 'lock'])->middleware('can:host,room');
            Route::post('unlock', [RoomLifecycleController::class, 'unlock'])->middleware('can:host,room');
            Route::post('end', [RoomLifecycleController::class, 'end'])->middleware('can:host,room');
            Route::post('co-hosts/{user}', [RoomParticipantController::class, 'coHost'])->middleware('can:appointCoHost,room,user');

            Route::get('audit-log', [RoomAuditLogController::class, 'index'])->middleware('can:host,room');
        });

        Route::get('messages/{message}', [MessageController::class, 'show'])->middleware('can:view,message');
        Route::patch('messages/{message}', [MessageController::class, 'update'])->middleware('can:update,message');
        Route::delete('messages/{message}', [MessageController::class, 'destroy'])->middleware('can:delete,message');
    });
});
