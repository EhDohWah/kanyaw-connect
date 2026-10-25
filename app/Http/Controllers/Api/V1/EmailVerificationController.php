<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Auth\VerifyEmail;
use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class EmailVerificationController extends Controller
{
    /** Emails a new verification link, unless the address is verified already. */
    public function send(Request $request): JsonResponse
    {
        $user = $request->user();

        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => __('Your email address is already verified.'), 'verified' => true]);
        }

        $user->sendEmailVerificationNotification();

        return response()->json(['message' => __('We have emailed you a new verification link.'), 'verified' => false]);
    }

    /**
     * The link from the email (signature and expiry checked by the route). Answers without the
     * profile: whoever has the link may verify the address, not read the account.
     */
    public function verify(string $id, string $hash, VerifyEmail $action): JsonResponse
    {
        $user = User::findOrFail($id);
        $changed = $action->handle($user, $hash);

        return response()->json([
            'message' => $changed ? __('Your email address is verified.') : __('Your email address is already verified.'),
            'verified' => true,
        ]);
    }
}
