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
use App\Models\Device;
use App\Models\Message;
use App\Services\DeviceResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;

class MessageController extends Controller
{
    private const RELATIONS = ['sender', 'replyTo', 'attachment'];

    public function __construct(private DeviceResolver $devices) {}

    /**
     * Newest first. In an encrypted chat the X-Device-Id header is required and each message carries
     * only that device's own envelope.
     */
    public function index(Request $request, Chat $chat): AnonymousResourceCollection
    {
        $device = $chat->is_encrypted ? $this->devices->required($request) : null;

        $messages = $chat->messages()
            ->with(self::RELATIONS)
            ->when($device, fn ($query) => $query->with(['envelopes' => $this->ownEnvelopes($device)]))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->cursorPaginate($this->perPage($request))
            ->withQueryString();

        return MessageResource::collection($messages);
    }

    public function store(StoreMessageRequest $request, Chat $chat, SendMessage $action): JsonResponse
    {
        $device = $chat->is_encrypted ? $this->devices->required($request) : null;

        [$message, $created] = $action->handle($chat, $request->user(), $request->validated(), $device);

        $message->loadMissing(self::RELATIONS);

        if ($message->isEncrypted()) {
            // The sender gets no envelope back: its own device already has the plaintext.
            $message->setRelation('envelopes', $message->newCollection());
        }

        return (new MessageResource($message))
            ->response()
            ->setStatusCode($created ? 201 : 200);
    }

    /** One message. In an encrypted chat the X-Device-Id header is required, as for the list. */
    public function show(Request $request, Message $message): MessageResource
    {
        $device = $message->chat->is_encrypted ? $this->devices->required($request) : null;

        $message->loadMissing(self::RELATIONS);

        if ($device) {
            $message->load(['envelopes' => $this->ownEnvelopes($device)]);
        }

        return new MessageResource($message);
    }

    public function update(UpdateMessageRequest $request, Message $message, UpdateMessage $action): MessageResource
    {
        $action->handle($message, $request->validated('content'));

        return new MessageResource($message->loadMissing(self::RELATIONS));
    }

    /** Constrain an envelopes relation to the one addressed to this device. */
    private function ownEnvelopes(Device $device): \Closure
    {
        return fn ($query) => $query->where('recipient_device_id', $device->getKey());
    }

    public function destroy(Message $message, DeleteMessage $action): Response
    {
        $action->handle($message);

        return response()->noContent();
    }
}
