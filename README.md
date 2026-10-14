# Karen Connect — Backend API

Laravel API for a private chat + video platform. See the build spec for the phase plan.
**Status: Phase 1 (foundation & auth) complete.** The full README (deployment, Reverb, LiveKit/TURN) is written in Phase 6.

## Local setup

```bash
cp .env.example .env
docker compose up -d postgres redis      # or use locally installed Postgres 16 + Redis
composer install
php artisan key:generate
php artisan migrate:fresh --seed         # seeded users: user1@example.com … user5@example.com, password "password"
php artisan storage:link                 # serves uploaded avatars from /storage
php artisan serve
```

## Tests and style

```bash
./vendor/bin/pest      # needs the kanyaw_connect_test Postgres database (docker compose creates it)
./vendor/bin/pint
```

## API (Phase 1)

All routes are under `/api/v1`. Send `Accept: application/json`; authenticated routes take `Authorization: Bearer <token>`.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `name, email, password, password_confirmation, phone?` → 201 `{ data: user }` (does not log in) |
| POST | `/auth/login` | `email, password, device_name?` → `{ token, user }`; 5 attempts/min per email+IP, then 429 |
| POST | `/auth/logout` | revokes the current token only |
| GET | `/me` | `{ data: user }` |
| PATCH | `/me` | `name, phone, timezone, locale (en/my/ksw), settings` — `settings` is merged key-by-key |
| POST | `/me/avatar` | multipart `avatar` (jpg/png/webp, ≤ 2 MB); stores original + 256×256 WebP thumbnail |
