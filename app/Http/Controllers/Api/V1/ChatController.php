<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Chats\CreateDirectChat;
use App\Actions\Chats\CreateGroupChat;
use App\Actions\Chats\RemoveChatMember;
use App\Actions\Chats\UpdateChat;
use App\Http\Controllers\Controller;
use App\Http\Requests\Chats\StoreDirectChatRequest;
use App\Http\Requests\Chats\StoreGroupChatRequest;
use App\Http\Requests\Chats\UpdateChatRequest;
use App\Http\Resources\ChatResource;
use App\Models\Chat;
use App\Models\User;
use App\Services\ChatListService;
use App\Services\DeviceResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class ChatController extends Controller
{
    public function __construct(private ChatListService $chats, private DeviceResolver $devices) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        return ChatResource::collection($this->chats->paginate($request->user(), $this->perPage($request), $this->devices->optional($request)));
    }

    public function show(Request $request, Chat $chat): ChatResource
    {
        return new ChatResource($this->chats->find($request->user(), $chat, $this->devices->optional($request)));
    }

    public function storeDirect(StoreDirectChatRequest $request, CreateDirectChat $action): JsonResponse
    {
        [$chat, $created] = $action->handle($request->user(), User::findOrFail($request->validated('user_id')), $request->boolean('is_encrypted'));

        return (new ChatResource($this->chats->find($request->user(), $chat)))
            ->response()
            ->setStatusCode($created ? 201 : 200);
    }

    public function storeGroup(StoreGroupChatRequest $request, CreateGroupChat $action): JsonResponse
    {
        $chat = $action->handle($request->user(), $request->validated());

        return (new ChatResource($this->chats->find($request->user(), $chat)))
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateChatRequest $request, Chat $chat, UpdateChat $action): ChatResource
    {
        $action->handle($chat, $request->validated());

        return new ChatResource($this->chats->find($request->user(), $chat));
    }

    public function leave(Request $request, Chat $chat, RemoveChatMember $action): Response
    {
        $action->handle($chat, $request->user());

        return response()->noContent();
    }
}
