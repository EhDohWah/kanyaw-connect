#!/bin/sh
# Runs first in every container of the app (web server, Reverb, queue worker, scheduler, migrations),
# prepares the container, then starts the command it was given.
set -eu

cd /app

if [ "${APP_ENV:-}" = "production" ]; then
    if [ -f .docker-development ]; then
        echo "ERROR: this is the development image (it has test tools and a public demo key)." >&2
        echo "       Build the production one instead: docker compose -f docker-compose.yml -f docker-compose.prod.yml build" >&2
        exit 1
    fi

    if [ -z "${APP_KEY:-}" ]; then
        echo "ERROR: APP_KEY is not set. Generate one with: docker compose run --rm --no-deps app php artisan key:generate --show" >&2
        exit 1
    fi
fi

# A volume mounted on storage/ starts empty, so make sure the folders Laravel writes to exist.
mkdir -p storage/app/private storage/app/public storage/framework/cache/data \
    storage/framework/sessions storage/framework/views storage/logs bootstrap/cache

if [ "${APP_ENV:-}" = "production" ]; then
    # Read the settings once instead of on every request. This has to happen here, not while the image
    # is built, because the settings only exist when the container starts.
    php artisan config:cache --no-interaction
    php artisan route:cache --no-interaction
    php artisan event:cache --no-interaction
fi

exec "$@"
