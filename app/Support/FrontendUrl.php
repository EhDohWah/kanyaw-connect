<?php

namespace App\Support;

/**
 * Links to pages of the web app (config/account.php), for emails: the API itself has no pages.
 */
class FrontendUrl
{
    /**
     * @param  array<string, string>  $query
     */
    public static function to(string $page, array $query = []): string
    {
        $url = config('account.frontend_url').'/'.ltrim($page, '/');

        return $query === [] ? $url : $url.'?'.http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    }
}
