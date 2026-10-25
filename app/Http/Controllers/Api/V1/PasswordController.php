<?php

namespace App\Http\Controllers\Api\V1;

use App\Actions\Auth\ChangePassword;
use App\Actions\Auth\ResetPassword;
use App\Actions\Auth\SendPasswordResetLink;
use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\ChangePasswordRequest;
use App\Http\Requests\Auth\ForgotPasswordRequest;
use App\Http\Requests\Auth\ResetPasswordRequest;
use Illuminate\Http\JsonResponse;

class PasswordController extends Controller
{
    /** "Forgot your password?": always the same answer, whether or not the address has an account. */
    public function forgot(ForgotPasswordRequest $request, SendPasswordResetLink $action): JsonResponse
    {
        $action->handle($request->validated('email'));

        return response()->json([
            'message' => __('If an account uses that address, we have emailed it a link to reset the password.'),
        ]);
    }

    /** The new password, with the token from the emailed link. Signs out every device. */
    public function reset(ResetPasswordRequest $request, ResetPassword $action): JsonResponse
    {
        $action->handle($request->validated('email'), $request->validated('token'), $request->validated('password'));

        return response()->json(['message' => __('Your password has been reset. Sign in with the new one.')]);
    }

    /** Signed in, knowing the current password. Signs out every other device. */
    public function update(ChangePasswordRequest $request, ChangePassword $action): JsonResponse
    {
        $action->handle(
            $request->user(),
            $request->validated('current_password'),
            $request->validated('password'),
            $request->user()->currentAccessToken(),
        );

        return response()->json(['message' => __('Your password has been changed. Your other devices have been signed out.')]);
    }
}
