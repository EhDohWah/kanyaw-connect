<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Chats\AddChatMembers;
use App\Actions\Chats\ChangeMemberRole;
use App\Actions\Chats\RemoveChatMember;
use App\Enums\ChatRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\Chats\AddMembersRequest;
use App\Http\Requests\Chats\UpdateMemberRoleRequest;
use App\Http\Resources\ChatResource;
use App\Models\Chat;
use App\Models\User;
use App\Services\ChatListService;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class ChatMemberController extends Controller
{
    public function __construct(private ChatListService $chats) {}

    public function store(AddMembersRequest $request, Chat $chat, AddChatMembers $action): ChatResource
    {
        $action->handle($chat, $request->validated('user_ids'));

        return new ChatResource($this->chats->find($request->user(), $chat));
    }

    public function update(UpdateMemberRoleRequest $request, Chat $chat, User $user, ChangeMemberRole $action): ChatResource
    {
        $action->handle($chat, $user, ChatRole::from($request->validated('role')));

        return new ChatResource($this->chats->find($request->user(), $chat));
    }

    public function destroy(Request $request, Chat $chat, User $user, RemoveChatMember $action): Response
    {
        $action->handle($chat, $user);

        return response()->noContent();
    }
}
