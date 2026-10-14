<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Messages\DeleteMessage;
use App\Actions\Messages\SendMessage;
use App\Actions\Messages\UpdateMessage;
use App\Http\Controllers\Controller;
use App\Http\Requests\Messages\StoreMessageRequest;
use App\Http\Requests\Messages\UpdateMessageRequest;
use App\Http\Resources\MessageResource;
use App\Models\Chat;
use App\Models\Message;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class MessageController extends Controller
{
    private const RELATIONS = ['sender', 'replyTo', 'attachment'];

    /** Newest first. */
    public function index(Request $request, Chat $chat): AnonymousResourceCollection
    {
        $messages = $chat->messages()
            ->with(self::RELATIONS)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($this->perPage($request))
            ->withQueryString();

        return MessageResource::collection($messages);
    }

    public function store(StoreMessageRequest $request, Chat $chat, SendMessage $action): JsonResponse
    {
        [$message, $created] = $action->handle($chat, $request->user(), $request->validated());

        return (new MessageResource($message->loadMissing(self::RELATIONS)))
            ->response()
            ->setStatusCode($created ? 201 : 200);
    }

    public function update(UpdateMessageRequest $request, Message $message, UpdateMessage $action): MessageResource
    {
        $action->handle($message, $request->validated('content'));

        return new MessageResource($message->loadMissing(self::RELATIONS));
    }

    public function destroy(Message $message, DeleteMessage $action): Response
    {
        $action->handle($message);

        return response()->noContent();
    }
}
