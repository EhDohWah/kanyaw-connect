<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Chats\MarkChatRead;
use App\Http\Controllers\Controller;
use App\Http\Requests\Chats\MarkChatReadRequest;
use App\Models\Chat;
use Illuminate\Http\JsonResponse;

class ChatReadController extends Controller
{
    public function store(MarkChatReadRequest $request, Chat $chat, MarkChatRead $action): JsonResponse
    {
        $membership = $action->handle($chat, $request->user(), $request->validated('message_id'));

        return response()->json(['data' => [
            'chat_id' => $chat->getKey(),
            'last_read_message_id' => $membership->last_read_message_id,
            'last_read_at' => $membership->last_read_at,
            'unread_count' => $chat->unreadCountFor($request->user()),
        ]]);
    }
}
