<?php

return [

    /*
    | Participant limits. The default is used when a room is created without max_participants.
    */
    'default_max_participants' => 50,
    'max_participants' => 100,

    /*
    | A join request reserves a seat for this many seconds while the client connects to LiveKit.
    | Without this, two people asking for the last seat at the same moment would both get a token.
    */
    'seat_hold_seconds' => 120,

    /*
    | How long a LiveKit room stays open after the last person leaves before LiveKit closes it
    | (which ends our room). Also bounds how long a room can sit empty.
    */
    'livekit_empty_timeout_seconds' => 300,

    /*
    | When the host's connection drops, wait this long before handing the host role to someone else.
    | 0 transfers the moment LiveKit reports the host left. On unstable mobile connections a value
    | such as 30 stops a brief drop from costing the host their role.
    */
    'host_transfer_grace_seconds' => (int) env('ROOM_HOST_TRANSFER_GRACE', 0),

];
