<?php

namespace App\Actions\Users;

use App\Actions\Calls\CancelCall;
use App\Actions\Calls\DeclineCall;
use App\Actions\Calls\EndCall;
use App\Actions\Chats\RemoveChatMember;
use App\Actions\Devices\RevokeDevice;
use App\Actions\Rooms\EndRoom;
use App\Enums\CallStatus;
use App\Enums\ChatType;
use App\Enums\RoomStatus;
use App\Enums\UserStatus;
use App\Exceptions\CallConflictException;
use App\Models\Attachment;
use App\Models\Call;
use App\Models\ChatMember;
use App\Models\Room;
use App\Models\User;
use App\Services\AttachmentStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Deletes an account for good (DELETE /me). The stores require an in-app way to do this.
 *
 * Everything personal goes: sessions, push registrations, device keys, the profile and avatar, group
 * memberships and every file the account uploaded. What other people hold stays: messages it sent
 * remain in their chats, and calls in their history, with the sender shown as "Deleted user".
 *
 * For that, the users row is kept as an empty, soft-deleted tombstone: name "Deleted user", an
 * unusable email and password, nothing else. It cannot sign in, cannot be found, added to a chat or
 * called, and the email address is free to register again. Direct chats keep the tombstone as their
 * second member, so the other person still sees who the conversation was with.
 *
 * Steps that tell other people (ending calls and meetings, leaving groups, revoking devices) and
 * file deletion come first: if one fails, nothing personal has been removed yet and the request can
 * simply be repeated. Each step is safe to repeat.
 */
class DeleteAccount
{
    public const DISPLAY_NAME = 'Deleted user';

    public function __construct(
        private CancelCall $cancelCall,
        private DeclineCall $declineCall,
        private EndCall $endCall,
        private EndRoom $endRoom,
        private RemoveChatMember $leaveChat,
        private RevokeDevice $revokeDevice,
        private AttachmentStorage $attachments,
    ) {}

    /**
     * @throws ValidationException when the password is wrong
     */
    public function handle(User $user, #[\SensitiveParameter] string $password): void
    {
        if (! Hash::check($password, $user->password)) {
            throw ValidationException::withMessages([
                'password' => [__('The password is incorrect.')],
            ]);
        }

        $this->hangUp($user);
        $this->endMeetings($user);
        $this->leaveGroups($user);
        $this->revokeDevices($user);
        $this->deleteFiles($user);

        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            $user->nativePushTokens()->delete();
            $user->pushSubscriptions()->delete();
            $user->devices()->delete(); // their prekeys and envelopes go with them
            DB::table('password_reset_tokens')->where('email', $user->email)->delete();

            $user->forceFill([
                'name' => self::DISPLAY_NAME,
                'email' => "deleted-{$user->getKey()}@deleted.invalid", // .invalid can never be a real address
                'phone' => null,
                'password' => Str::random(64),
                'email_verified_at' => null,
                'avatar_path' => null,
                'status' => UserStatus::Offline,
                'last_seen_at' => null,
                'settings' => [],
                'remember_token' => null,
            ])->save();

            $user->delete(); // soft: the row stays as the tombstone
        });
    }

    /** A ringing or ongoing call ends as if they had hung up, so the other phone stops ringing. */
    private function hangUp(User $user): void
    {
        foreach (Call::active()->involving($user->getKey())->get() as $call) {
            try {
                match (true) {
                    $call->status === CallStatus::Ringing && $call->caller_id === $user->getKey() => $this->cancelCall->handle($call),
                    $call->status === CallStatus::Ringing => $this->declineCall->handle($call),
                    default => $this->endCall->handle($call),
                };
            } catch (CallConflictException) {
                // It changed meanwhile (answered, declined, ended): nothing left to do.
            }
        }
    }

    /** A meeting with nobody to host it cannot go on: live and scheduled ones end. */
    private function endMeetings(User $user): void
    {
        Room::where('host_id', $user->getKey())
            ->where('status', '!=', RoomStatus::Ended->value)
            ->get()
            ->each(fn (Room $room) => $this->endRoom->handle($room, $user));
    }

    /** Leave every group the usual way (ownership passes on, an empty group is deleted). */
    private function leaveGroups(User $user): void
    {
        ChatMember::query()
            ->where('user_id', $user->getKey())
            ->whereHas('chat', fn ($query) => $query->where('type', ChatType::Group->value))
            ->with('chat')
            ->get()
            ->each(fn (ChatMember $membership) => $this->leaveChat->handle($membership->chat, $user));
    }

    /** Contacts are told, so their apps stop encrypting for these devices. */
    private function revokeDevices(User $user): void
    {
        $user->devices()->whereNull('revoked_at')->get()->each(fn ($device) => $this->revokeDevice->handle($device));
    }

    /** The avatar and every uploaded attachment: files first, then the rows that name them. */
    private function deleteFiles(User $user): void
    {
        if ($user->avatar_path) {
            Storage::disk(StoreAvatar::DISK)->delete([$user->avatar_path, User::thumbnailPathFor($user->avatar_path)]);
            $user->forceFill(['avatar_path' => null])->save();
        }

        Attachment::where('uploader_id', $user->getKey())->chunkById(200, function ($attachments) {
            $this->attachments->deleteFiles($attachments);
            Attachment::whereIn('id', $attachments->modelKeys())->delete();
        });
    }
}
