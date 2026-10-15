<?php

namespace App\Services;

use App\Events\DeviceAdded;
use App\Events\DeviceBroadcastEvent;
use App\Events\DeviceRevoked;
use App\Models\ChatMember;
use App\Models\Device;
use App\Models\User;

/**
 * Tells the people who encrypt for a user that their device list changed, so their clients can
 * fetch key bundles and re-key. The audience is the user themself (their other devices) and everyone
 * who shares an ENCRYPTED chat with them; contacts they only have plaintext chats with are not told.
 * Payloads carry ids only: no device name and no keys.
 */
class DeviceBroadcaster
{
    /** The Pusher protocol allows at most 100 channels per published event. */
    private const MAX_CHANNELS_PER_EVENT = 100;

    public function added(Device $device): void
    {
        $this->send(DeviceAdded::class, $device);
    }

    public function revoked(Device $device): void
    {
        $this->send(DeviceRevoked::class, $device);
    }

    /**
     * @param  class-string<DeviceBroadcastEvent>  $event
     */
    private function send(string $event, Device $device): void
    {
        $payload = ['user_id' => $device->user_id, 'device_id' => $device->getKey()];

        foreach (array_chunk($this->audience($device->user_id), self::MAX_CHANNELS_PER_EVENT) as $userIds) {
            event(new $event($payload, $userIds));
        }
    }

    /**
     * @return list<string>
     */
    private function audience(string $ownerId): array
    {
        $contacts = ChatMember::query()
            ->join('chat_members as owner_membership', 'owner_membership.chat_id', '=', 'chat_members.chat_id')
            ->join('chats', 'chats.id', '=', 'chat_members.chat_id')
            ->where('owner_membership.user_id', $ownerId)
            ->where('chats.is_encrypted', true)
            ->whereNull('chats.deleted_at')
            ->distinct()
            ->pluck('chat_members.user_id')
            ->all();

        return array_values(array_unique([...$contacts, $ownerId]));
    }
}
