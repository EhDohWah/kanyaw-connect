# syntax=docker/dockerfile:1.7

# One image runs every PHP part of the app: the web server, Reverb (live updates), the queue worker,
# the scheduler and the database migrations. The role of a container is only the command it runs.
#
# Two targets:
#   development   what docker-compose.yml builds. Has the test tools and the demo-data seeder.
#   production    what docker-compose.prod.yml builds. No test tools, code that cannot change.

ARG PHP_VERSION=8.3

# ---------------------------------------------------------------------------
# base: PHP, the web server (FrankenPHP is the Caddy web server with PHP built in) and the
# extensions the app needs. The web server is already allowed to listen on ports 80 and 443
# without being root.
# ---------------------------------------------------------------------------
FROM dunglas/frankenphp:1-php${PHP_VERSION} AS base

# sodium (end-to-end encryption key checks) is already part of the base image.
RUN install-php-extensions bcmath exif gd intl pcntl pdo_pgsql redis zip

# Nothing in the container needs to run as root.
RUN useradd --uid 1000 --create-home --shell /bin/sh app \
    && chown -R app:app /app /data /config

COPY docker/php/app.ini ${PHP_INI_DIR}/conf.d/zz-app.ini
COPY docker/Caddyfile /etc/frankenphp/Caddyfile
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chmod=0755 docker/bootstrap-db.sh /usr/local/bin/bootstrap-db.sh

ENV SERVER_NAME=":80" \
    COMPOSER_HOME=/tmp/composer

WORKDIR /app
USER app
EXPOSE 80

# The base image checks the web server's admin port, which only the web server container has.
# docker-compose.yml gives the containers that can be checked (app, reverb) their own check.
HEALTHCHECK NONE

ENTRYPOINT ["entrypoint.sh"]
CMD ["frankenphp", "run", "--config", "/etc/frankenphp/Caddyfile", "--adapter", "caddyfile"]


# ---------------------------------------------------------------------------
# development: everything, including the test tools. docker-compose.prod.yml never uses this target.
# ---------------------------------------------------------------------------
FROM base AS development

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

# The dependencies first, so that changing application code does not download them again.
COPY --chown=app:app composer.json composer.lock ./
RUN composer install --no-interaction --no-progress --no-scripts --no-autoloader --prefer-dist

COPY --chown=app:app . .

# .docker-development marks this image as the development one (the entrypoint refuses to run it as
# production). The empty .env is not for settings (those come from the environment): without a file
# the settings loader reports a failed read in every test.
RUN mkdir -p storage/app/private storage/app/public storage/framework/cache/data \
        storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && composer dump-autoload --optimize \
    && touch .docker-development .env

ENV APP_ENV=local


# ---------------------------------------------------------------------------
# build-production: installs the dependencies without the test tools. Only its result is kept.
# ---------------------------------------------------------------------------
FROM base AS build-production

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer

COPY --chown=app:app composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --no-progress --no-scripts --no-autoloader --prefer-dist

COPY --chown=app:app app ./app
COPY --chown=app:app bootstrap ./bootstrap
COPY --chown=app:app config ./config
COPY --chown=app:app database ./database
COPY --chown=app:app public ./public
COPY --chown=app:app routes ./routes
COPY --chown=app:app artisan ./artisan

RUN mkdir -p storage/app/private storage/app/public storage/framework/cache/data \
        storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && composer dump-autoload --no-dev --classmap-authoritative


# ---------------------------------------------------------------------------
# production: the application, its dependencies and nothing else (no Composer, no tests).
# ---------------------------------------------------------------------------
FROM base AS production

COPY --from=build-production --chown=app:app /app /app
COPY docker/php/production.ini ${PHP_INI_DIR}/conf.d/zz-production.ini

ENV APP_ENV=production \
    APP_DEBUG=false
