<?php

namespace App\Actions\Calls;

use App\Actions\Push\NotifyCallParties;
use App\Enums\CallKind;
use App\Enums\CallStatus;
use App\Enums\RoomAdmission;
use App\Enums\RoomRole;
use App\Enums\RoomType;
use App\Exceptions\CallConflictException;
use App\Jobs\ExpireRingingCall;
use App\Models\Call;
use App\Models\Chat;
use App\Models\Room;
use App\Models\User;
use App\Services\CallBroadcaster;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class StartCall
{
    public function __construct(private ExpireRingingCalls $expire, private CallBroadcaster $broadcaster, private NotifyCallParties $notifier) {}

    /**
     * Ring the other member of a direct chat. Creates the call's two-seat room (the caller as host,
     * the callee already admitted, no password, no waiting room, no "room started" message) and the
     * call itself, ringing until ring_expires_at.
     *
     * The policy has checked that the chat is direct and the caller is in it.
     *
     * @throws CallConflictException already_in_call, or callee_busy
     */
    public function handle(Chat $chat, User $caller, CallKind $kind): Call
    {
        $calleeId = $chat->members()->where('users.id', '!=', $caller->getKey())->value('users.id');

        // A call that rang out a moment ago may still say "ringing" (the timeout job runs a little
        // late): settle those first, so they do not make anyone look busy.
        $this->expire->handle([$caller->getKey(), $calleeId]);

        $call = DB::transaction(function () use ($chat, $caller, $calleeId, $kind) {
            // Lock both people, always in the same order (so two people calling each other at the
            // same moment cannot deadlock). Every start involving either of them waits here, so two
            // starts can never both pass the busy checks below.
            User::whereKey([$caller->getKey(), $calleeId])->orderBy('id')->lockForUpdate()->pluck('id');

            if (Call::active()->involving($caller)->exists()) {
                throw CallConflictException::alreadyInCall();
            }

            if (Call::active()->involving($calleeId)->exists()) {
                throw CallConflictException::calleeBusy();
            }

            $room = Room::create([
                'type' => RoomType::Instant,
                'name' => $kind === CallKind::Voice ? 'Voice call' : 'Video call',
                'host_id' => $caller->getKey(),
                'chat_id' => $chat->getKey(),
                'waiting_room_enabled' => false,
                'max_participants' => 2,
                'livekit_room_name' => 'kc-call-'.Str::uuid(),
            ]);

            $room->participants()->createMany([
                ['user_id' => $caller->getKey(), 'role' => RoomRole::Host, 'admission' => RoomAdmission::Admitted],
                ['user_id' => $calleeId, 'role' => RoomRole::Participant, 'admission' => RoomAdmission::Admitted],
            ]);

            return Call::create([
                'chat_id' => $chat->getKey(),
                'room_id' => $room->getKey(),
                'caller_id' => $caller->getKey(),
                'callee_id' => $calleeId,
                'kind' => $kind,
                'status' => CallStatus::Ringing,
                'ring_expires_at' => now()->addSeconds(config('calls.ring_seconds')),
            ]);
        });

        $this->broadcaster->incoming($call);
        $this->notifier->incoming($call);
        ExpireRingingCall::dispatch($call->getKey())->delay($call->ring_expires_at);

        return $call;
    }
}
