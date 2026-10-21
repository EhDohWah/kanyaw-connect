#!/bin/sh
# Runs once per `docker compose up`, before the app starts: brings the database up to date and,
# if asked to, fills an empty database with demo people and chats.
set -eu

cd /app

# Check the request before touching the database.
if [ "${SEED_DEMO_DATA:-false}" = "true" ] && [ ! -f .docker-development ]; then
    echo "ERROR: SEED_DEMO_DATA=true is only possible with the development image (the demo data needs the test tools)." >&2
    exit 1
fi

php artisan migrate --force --no-interaction

if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
    # Only into an empty database. Seeding twice would fail on the e-mail addresses that must be unique,
    # and would put demo people next to real ones.
    has_users=$(php -r 'require "vendor/autoload.php"; $app = require "bootstrap/app.php"; $app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap(); echo App\Models\User::query()->exists() ? "yes" : "no";')

    if [ "$has_users" = "no" ]; then
        php artisan db:seed --force --no-interaction
        echo "Demo data created: user1@example.com ... user5@example.com, password \"password\"."
    else
        echo "The database already has people in it, so no demo data was added."
    fi
fi
