<?php

use App\Http\Controllers\Api\V1\AttachmentController;
use App\Http\Controllers\Api\V1\AttachmentFileController;
use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\ChatController;
use App\Http\Controllers\Api\V1\ChatMemberController;
use App\Http\Controllers\Api\V1\ChatReadController;
use App\Http\Controllers\Api\V1\MeController;
use App\Http\Controllers\Api\V1\MessageController;
use Illuminate\Support\Facades\Route;

// All routes below are served under /api/v1 (the /api prefix comes from bootstrap/app.php).
Route::prefix('v1')->group(function () {
    Route::prefix('auth')->group(function () {
        Route::post('register', [AuthController::class, 'register']);
        Route::post('login', [AuthController::class, 'login'])->middleware('throttle:login');
        Route::post('logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
    });

    // Attachment bytes: authorised by the signature on the URL, not by a bearer token.
    Route::middleware('signed')->group(function () {
        Route::get('attachments/{attachment}/file', [AttachmentFileController::class, 'file'])->name('attachments.file');
        Route::get('attachments/{attachment}/thumbnail', [AttachmentFileController::class, 'thumbnail'])->name('attachments.thumbnail');
    });

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', [MeController::class, 'show']);
        Route::patch('me', [MeController::class, 'update']);
        Route::post('me/avatar', [MeController::class, 'avatar']);

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
        });

        Route::patch('messages/{message}', [MessageController::class, 'update'])->middleware('can:update,message');
        Route::delete('messages/{message}', [MessageController::class, 'destroy'])->middleware('can:delete,message');
    });
});
