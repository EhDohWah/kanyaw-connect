<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Attachments\StoreAttachment;
use App\Http\Controllers\Controller;
use App\Http\Requests\Attachments\StoreAttachmentRequest;
use App\Http\Resources\AttachmentResource;
use App\Models\Chat;
use Illuminate\Http\JsonResponse;

class AttachmentController extends Controller
{
    public function store(StoreAttachmentRequest $request, Chat $chat, StoreAttachment $action): JsonResponse
    {
        $attachment = $action->handle($chat, $request->user(), $request->file('file'));

        return (new AttachmentResource($attachment))->response()->setStatusCode(201);
    }
}
