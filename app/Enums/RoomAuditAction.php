<?php

namespace App\Enums;

/** What was done to a room. The values are what the API returns in `action`. */
enum RoomAuditAction: string
{
    case Created = 'room.created';
    case ParticipantAdmitted = 'room.participant_admitted';
    case ParticipantDenied = 'room.participant_denied';
    case ParticipantRemoved = 'room.participant_removed';
    case ParticipantMuted = 'room.participant_muted';
    case CoHostAppointed = 'room.co_host_appointed';
    case Locked = 'room.locked';
    case Unlocked = 'room.unlocked';
    case Ended = 'room.ended';
    /** The system handed the host role to someone else because the host left. */
    case HostTransferred = 'room.host_transferred';
    /** The system ended a room that was left behind (see config/cleanup.php). */
    case AutoEnded = 'room.auto_ended';
}
