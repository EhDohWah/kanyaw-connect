<?php

return [

    /*
    | Where the web app lives. The links in emails (reset your password, verify your address) open
    | pages of the app, not of this API: "{FRONTEND_URL}/reset-password?token=…". Use the address
    | people open in their browser, without a trailing slash.
    */
    'frontend_url' => rtrim((string) env('FRONTEND_URL', 'http://localhost:5173'), '/'),

    /*
    | How long the link in a verification email works, in minutes (a day by default: people often
    | open the email later). A password reset link works for 60 minutes (config/auth.php).
    */
    'verification_expire_minutes' => (int) env('EMAIL_VERIFICATION_EXPIRE', 1440),

];
