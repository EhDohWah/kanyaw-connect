<?php

return [

    /*
    | How long a call rings before it counts as missed (no_answer). The incoming-call push lives
    | exactly this long, so a phone that comes online later never shows a call that is over.
    */
    'ring_seconds' => (int) env('CALL_RING_SECONDS', 45),

    /*
    | When one of the two drops out of a call that was answered, wait this long for them to come
    | back before ending the call (connection_lost). Needs the queue worker.
    */
    'reconnect_grace_seconds' => (int) env('CALL_RECONNECT_GRACE', 30),

];
