<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;

abstract class Controller
{
    /** Page size from ?per_page=, clamped to the configured limits. */
    protected function perPage(Request $request): int
    {
        return max(1, min(
            $request->integer('per_page', config('chat.default_per_page')),
            config('chat.max_per_page'),
        ));
    }
}
