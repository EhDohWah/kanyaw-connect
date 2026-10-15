# Karen Connect — Backend API

The backend for **Karen Connect**, a private chat and video-meeting app for a Karen community organisation. Many of its users are on slow or unstable mobile connections along the Thai–Myanmar border, so the API keeps payloads small, paginates every list, and makes every send safe to retry. Privacy is a core requirement: in end-to-end encrypted chats the server never sees message content.

This repository is the API only. The frontend is a separate Vue 3 project that talks to it. **[docs/API.md](docs/API.md) is the contract with that frontend**: every endpoint, every real-time event, with examples.

| | |
|---|---|
| Framework | Laravel 13, PHP 8.3+ |
| Database | PostgreSQL 16 |
| Cache, queues, presence | Redis |
| Authentication | Laravel Sanctum bearer tokens (30 days) |
| WebSockets | Laravel Reverb |
| Video | LiveKit (self-hosted), via `agence104/livekit-server-sdk` |
| Push notifications | Web Push (VAPID), via `minishlink/web-push` |
| Tests, style | Pest, Laravel Pint |

**What it does:** accounts and profiles · one-to-one and group chats with roles · text, image, voice and file messages with replies, edits and deletes · read positions and unread counts · online presence and typing indicators · real-time delivery · video rooms with passwords, waiting rooms, locking, co-hosts, muting and removal · end-to-end encrypted chats (server side: a key directory and ciphertext relay) · web push notifications · a room audit log · scheduled clean-up.

## Contents

- [Quick start](#quick-start)
- [Processes the app needs](#processes-the-app-needs)
- [Docker](#docker)
- [Configuration](#configuration)
- [Scheduled jobs](#scheduled-jobs)
- [LiveKit and TURN](#livekit-and-turn)
- [Web push](#web-push)
- [End-to-end encryption](#end-to-end-encryption)
- [Security](#security)
- [Tests and code style](#tests-and-code-style)
- [Deployment checklist](#deployment-checklist)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

## Quick start

You need PHP 8.3+ with the extensions `bcmath`, `curl`, `gd`, `intl`, `mbstring`, `openssl`, `pcntl`, `pdo_pgsql`, `redis`, `sodium`, `zip` (Composer checks the required ones), Composer, PostgreSQL 16 and Redis. The easiest way to get the databases is Docker (below), but locally installed ones work as well.

```bash
cp .env.example .env
docker compose up -d postgres redis      # or use your own Postgres 16 + Redis
composer install
php artisan key:generate
php artisan migrate:fresh --seed         # sample data, see below
php artisan storage:link                 # serves uploaded avatars from /storage
php artisan serve                        # http://localhost:8000
```

`migrate:fresh --seed` creates five users (`user1@example.com` … `user5@example.com`, all with the password `password`), two direct chats with a few messages, one group chat and one scheduled video room. **Never run it on a database that holds real data:** `migrate:fresh` drops every table.

Check it works:

```bash
curl -s localhost:8000/api/v1/auth/login -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"email":"user1@example.com","password":"password","device_name":"curl"}'
```

The same account can then call, for example, `GET /api/v1/chats` with `Authorization: Bearer <token>`.

## Processes the app needs

`php artisan serve` alone gives you the REST API. Everything real-time or scheduled needs its own process; in production each runs under a process manager (see the [checklist](#deployment-checklist)).

| Process | Command | Without it |
|---|---|---|
| Web server | `php artisan serve` (development) · PHP-FPM + nginx (production) | No API |
| Queue worker | `php artisan queue:work` | Real-time events are never published, no push notifications, no thumbnails, no delayed host transfer |
| Reverb (WebSockets) | `php artisan reverb:start` (port 8080) | No real-time updates; the REST API still works |
| Scheduler | `php artisan schedule:work` (development) · one cron line `* * * * * php artisan schedule:run` (production) | Users never go offline, clean-up never runs |
| LiveKit | `docker compose up -d livekit` | Nobody can join a video room (`503`) |

Leave `REDIS_QUEUE_BLOCK_FOR` at its default so the worker picks up events immediately instead of polling every few seconds.

## Docker

`docker-compose.yml` starts the infrastructure for local development. Laravel, Reverb and the queue worker run on your machine via `artisan`.

| Service | Image | Ports | Notes |
|---|---|---|---|
| `postgres` | `postgres:16` | 5432 | Database `kanyaw_connect` (user `kanyaw`, password `secret`). A second database, `kanyaw_connect_test`, is created for the test suite. Data lives in the `postgres-data` volume. |
| `redis` | `redis:7` | 6379 | Cache, queues, presence. Volume `redis-data`. |
| `livekit` | `livekit/livekit-server` | 7880 (signalling), 7881/tcp, 50000–50100/udp | Configured by `docker/livekit/livekit.yaml` (development key and secret, webhook to `host.docker.internal:8000`). |

```bash
docker compose up -d            # everything
docker compose up -d postgres redis
docker compose down             # stop (data stays); add -v to delete the volumes too
```

The compose file is for development. It has not been run in the environment this code was built in (there is no Docker daemon there); the LiveKit and database behaviour were verified against locally started servers instead. For production see [LiveKit and TURN](#livekit-and-turn) and the [checklist](#deployment-checklist).

## Configuration

Settings come from environment variables (`.env`). Run `php artisan config:cache` in production: nothing in the code reads `env()` outside the `config/` files, so caching is safe. `.env.example` lists everything with development defaults.

### Application and database

| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV`, `APP_DEBUG` | `local`, `true` | **In production use `production` and `false`.** With debug on, error responses include stack traces and file paths. |
| `APP_URL` | `http://localhost:8000` | The public URL of the API. Signed attachment URLs are built from it. |
| `APP_KEY` | | Generate with `php artisan key:generate`. Losing it makes stored push secrets unreadable. |
| `FRONTEND_URL` | `http://localhost:5173` | Origin of the Vue frontend. |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` | `127.0.0.1`, `5432`, `kanyaw_connect`, `kanyaw`, `secret` | PostgreSQL |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | `127.0.0.1`, `6379`, `null` | Redis |
| `CACHE_STORE`, `QUEUE_CONNECTION` | `redis`, `redis` | Keep both on Redis: presence and the queue depend on it. |
| `CHAT_ATTACHMENTS_DISK` | `local` | Filesystem disk for attachments (private, served only through signed URLs). Use an S3 disk to keep them off the server. |

### Authentication, CORS and security

| Variable | Default | Meaning |
|---|---|---|
| `SANCTUM_TOKEN_EXPIRATION` | `43200` | Login token lifetime in minutes (43200 = 30 days). `0` = never expires. |
| `SANCTUM_STATEFUL_DOMAINS` | `localhost:5173` | Only for cookie sessions, which this API does not use. Bearer tokens need nothing. |
| `SANCTUM_TOKEN_PREFIX` | empty | Optional prefix for new tokens (helps secret scanners find leaked tokens). |
| `CORS_ALLOWED_ORIGINS` | `FRONTEND_URL` | Browser origins allowed to call the API, comma separated. |
| `TRUSTED_PROXIES` | empty | Proxies whose `X-Forwarded-*` headers are trusted: `*` or comma separated IPs / CIDRs. **Required behind a reverse proxy or load balancer.** |
| `SECURITY_HSTS` | `true` | Send `Strict-Transport-Security` on HTTPS requests. |
| `API_RATE_LIMIT` | `300` | Requests per minute per signed-in user (flood backstop). |
| `REGISTER_RATE_LIMIT` | `20` | Sign-ups per hour per IP address. |

### Real-time (Reverb)

| Variable | Default | Meaning |
|---|---|---|
| `BROADCAST_CONNECTION` | `reverb` | |
| `REVERB_APP_ID`, `REVERB_APP_KEY`, `REVERB_APP_SECRET` | development values | Credentials of the Reverb application. **Change all three in production.** The key is public (the frontend uses it); the secret is not. |
| `REVERB_HOST`, `REVERB_PORT`, `REVERB_SCHEME` | `localhost`, `8080`, `http` | Where clients and the API reach Reverb. Production: your public host, `443`, `https`. |
| `REVERB_SERVER_HOST`, `REVERB_SERVER_PORT` | `0.0.0.0`, `8080` | What `reverb:start` listens on. |
| `REVERB_ALLOWED_ORIGINS` | `*` | Browser origins allowed to open a WebSocket. **Set to the frontend origin in production.** |
| `REVERB_MAX_REQUEST_SIZE` | `100000` | Largest event Reverb accepts, in bytes. 5000 Burmese or Karen characters are about 15 KB in UTF-8, so the library default of 10 KB is too small. |

### Video (LiveKit) and rooms

| Variable | Default | Meaning |
|---|---|---|
| `LIVEKIT_URL` | `ws://localhost:7880` | What **clients** connect to (`ws://` or `wss://`). |
| `LIVEKIT_HOST` | `http://localhost:7880` | What **the API** calls (`http://` or `https://`). Different on purpose: inside a private network it is usually an internal address. |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | development values | Must match the `keys:` entry in LiveKit's config. The secret also signs webhooks. |
| `LIVEKIT_TOKEN_TTL` | `3600` | Lifetime of a join token, seconds. |
| `ROOM_HOST_TRANSFER_GRACE` | `0` | Seconds to wait before handing the host role on when the host's connection drops. A value such as `30` stops a brief mobile drop from costing the host their role. Needs the queue worker. |

### Web push

| Variable | Default | Meaning |
|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | empty | Create with `php artisan push:vapid`. Push stays off while either is empty. |
| `VAPID_SUBJECT` | `mailto:` + `MAIL_FROM_ADDRESS` | A contact (`mailto:` or `https:`) push services can reach. |
| `PUSH_TTL` | `86400` | Seconds a push service keeps a notification for an offline phone. |
| `PUSH_URGENCY` | `high` | `very-low`, `low`, `normal` or `high`. Chat messages are `high` so phones in power-saving mode still deliver them. |
| `PUSH_SHOW_PREVIEW` | `true` | Show sender and first words in plaintext chats. Encrypted chats always say "New message". |
| `PUSH_SKIP_ONLINE` | `true` | Do not push to people whose app is open. |
| `PUSH_ALLOWED_HOSTS` | Google, Mozilla, Apple, Windows push services | Which push-service hosts a client may register (comma separated, `*.example.com` wildcards). Replaces the built-in list. |
| `PUSH_REQUIRE_HTTPS` | `true` | Only turn off to test against a plain-http fake push service. |

### Encryption and housekeeping

| Variable | Default | Meaning |
|---|---|---|
| `E2EE_VERIFY_SIGNED_PREKEY` | `true` | Verify the Ed25519 signature on signed prekeys (needs `ext-sodium`). |
| `CLEANUP_DELETED_MESSAGES_DAYS` | `30` | Deleted messages are removed for good after this many days. |
| `CLEANUP_ORPHAN_ATTACHMENT_HOURS` | `24` | Uploads never attached to a message are deleted after this many hours. |

Limits that rarely change (group size, page size, device and prekey limits, stale-room thresholds) are plain settings in `config/chat.php`, `config/e2ee.php`, `config/rooms.php` and `config/cleanup.php`.

## Scheduled jobs

All run through the scheduler (`schedule:work` or the cron line). Times are Thailand time (Asia/Bangkok), so the heavy ones run in the quiet hours.

| Command | When | What |
|---|---|---|
| `presence:mark-offline` | every minute | Marks users offline when their heartbeat (90 s) has expired |
| `rooms:end-stale` | every 15 minutes | Ends video rooms that were left behind: never joined (a day after they were due), started but empty for an hour, or running for over 24 hours. Also closes them in LiveKit. |
| `attachments:purge-orphans` | hourly | Deletes uploads that were never attached to a message (older than 24 h), files included |
| `messages:purge-deleted` | daily 03:10 | Permanently removes messages deleted more than 30 days ago, with their attachment files and encrypted copies |
| `sanctum:prune-expired --hours=24` | daily 03:30 | Deletes expired login tokens (and with them the push subscriptions made under them) |
| `queue:prune-failed --hours=168` | daily 03:40 | Forgets failed jobs older than a week |

Each command can also be run by hand, for example `php artisan messages:purge-deleted`; they print how much they removed and are safe to repeat. The longer jobs use `withoutOverlapping()` (a slow run never overlaps the next) and all but `presence:mark-offline` use `onOneServer()` (two servers do not both run it).

## LiveKit and TURN

Video runs on a self-hosted [LiveKit](https://livekit.io) server, which handles all WebRTC signalling, SDP and ICE. The API never touches media: it decides who may join and signs a token; the frontend connects to LiveKit with `livekit-client`.

**Development:** `docker compose up -d livekit` uses `docker/livekit/livekit.yaml`. Its key and secret must match `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`.

**The webhook is essential.** LiveKit reports who joined and left to `POST /api/v1/webhooks/livekit`; that is the **only** thing that sets `joined_at` / `left_at`, makes a room active, ends it when everyone has left, and moves the host role. Without it rooms never become active and seats are never freed. The `webhook:` section of LiveKit's config must point at the API, and the API must be reachable from the LiveKit server. The request is signed with the LiveKit secret and is rejected (`401`) otherwise.

**Production.** LiveKit needs a public address, TLS, and a **TURN server**. TURN relays media for people behind strict mobile or office firewalls, which is common for this audience; without it some calls will not connect. LiveKit has TURN built in, so no separate coturn is needed. A starting point is `docker/livekit/livekit.production.example.yaml` (copy it, fill in your domains and secrets). It has not been run against a real deployment, so check it against LiveKit's current documentation:

```yaml
port: 7880
log_level: info
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  YOUR_API_KEY: YOUR_LONG_RANDOM_SECRET
turn:
  enabled: true
  domain: turn.example.org            # a DNS name pointing at this server
  cert_file: /certs/fullchain.pem
  key_file: /certs/privkey.pem
  tls_port: 5349
  udp_port: 3478
webhook:
  api_key: YOUR_API_KEY
  urls:
    - https://api.example.org/api/v1/webhooks/livekit
```

Open these ports in the firewall: `443` (or your proxy's port) for signalling, `7881/tcp`, `3478/udp`, `5349/tcp` (TURN over TLS), and the UDP range `50000-60000`. Put TLS in front of the signalling port (7880) with nginx or Caddy so that `LIVEKIT_URL` can be `wss://livekit.example.org`; `LIVEKIT_HOST` can stay an internal `http://` address. A room that nobody is in is closed by LiveKit after `rooms.livekit_empty_timeout_seconds` (5 minutes), which the webhook turns into `status: ended`.

## Web push

Push notifications reach a phone whose app is closed. They need three things: the `VAPID_*` keys, the queue worker, and a frontend that registers a service worker (see section 6 of [docs/API.md](docs/API.md#6-guide-push-notifications)).

```bash
php artisan push:vapid        # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT for your .env
```

Create the pair once and keep it: replacing it signs every browser out of push. Notifications are encrypted for the browser (the push service cannot read them) and only ever contain "New message" for encrypted chats. The server only talks to the well-known push services; a client cannot make it call an arbitrary address (see `PUSH_ALLOWED_HOSTS`).

## End-to-end encryption

In an encrypted chat the server is only a **key directory** and a **ciphertext relay**. It stores public keys and opaque encrypted blobs, and never receives a private key or any plaintext. A test scans the source to prove that no code decrypts or reads ciphertext. The details of the endpoints and rules are in [docs/API.md, section 5](docs/API.md#5-guide-end-to-end-encryption).

> **For the frontend.** Use a vetted protocol, not home-made crypto. As a minimum, libsodium `crypto_box` / sealed boxes; ideally a Double Ratchet library (Signal-style). Ed25519 *signing* keys and X25519 *exchange* keys are two separate key pairs: never derive one from the other ad hoc.

What the server can still see is metadata: who is in which chat, who sent a message and from which device, when, how big it is, and its type. Say so in the app's privacy text. PHP needs `ext-sodium` (it is part of PHP's core) only to verify the signature on signed prekeys.

## Security

- **Authentication:** bearer tokens that expire after 30 days and are not extended by use; one token per device; logging out revokes only that device. Login is limited to 5 attempts a minute per email and IP address, registration to 20 an hour per IP address, and every signed-in user to 300 requests a minute.
- **Authorisation** lives in policies and route middleware, which run before validation: a stranger gets `403` whatever they send. Some lookups answer `404` instead, so ids cannot be probed (other people's devices, messages of chats you are not in).
- **Headers:** every response has `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive `Content-Security-Policy`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`; HTTPS responses also carry `Strict-Transport-Security`.
- **CORS** allows only the frontend origin(s) in `CORS_ALLOWED_ORIGINS`, with the headers the app uses (`Authorization`, `Content-Type`, `X-Device-Id`, `X-Socket-ID`).
- **Errors** never reveal stack traces, file paths or class names when `APP_DEBUG=false`.
- **Files:** attachments are private and served only through signed URLs that expire after an hour; the stored name comes from the file's content, never from the client; avatars exclude SVG.
- **Push endpoints:** only known browser push services are accepted, so the server cannot be aimed at internal addresses.
- **Audit log:** every action of a room host or co-host is recorded (who, what, to whom, when; no IP addresses) and readable by the host: `GET /rooms/{room}/audit-log`.
- **Secrets at rest:** passwords are hashed; room passwords are hashed; push auth secrets are encrypted with `APP_KEY`; end-to-end private keys never reach the server.

## Tests and code style

```bash
./vendor/bin/pest      # needs the kanyaw_connect_test database (docker compose creates it)
./vendor/bin/pint      # fixes style; add --test to only check
```

The suite has feature tests for every endpoint (happy path, `401`, `403`), concurrency tests that use real parallel processes (one-time prekeys can only be claimed once), source-scan tests (nothing decrypts ciphertext), and documentation tests: `docs/API.md` must list every route and every broadcast event, and its links and JSON examples must be valid. LiveKit and web push are replaced by fakes in the tests, so no network is needed. GitHub Actions runs Pint and Pest on every push (`.github/workflows/tests.yml`).

If Pest ends with no output at all, a fatal PHP error is probably being swallowed by the `laravel/pao` output filter; run `PAO_DISABLE=1 ./vendor/bin/pest` to see it.

## Deployment checklist

**Server and PHP**
- [ ] PHP 8.3+ with the extensions above; `upload_max_filesize` and `post_max_size` above 25 MB (for example `26M` and `30M`), or large uploads fail before Laravel sees them. Match `client_max_body_size` in nginx.
- [ ] PostgreSQL 16 and Redis 7, both reachable only from the app servers. Redis with persistence (`appendonly yes`) so queued events survive a restart. Backups of the database **and** of `storage/app/private` (attachments).
- [ ] HTTPS everywhere; the API, Reverb and LiveKit each behind TLS.

**Application**
- [ ] `.env` for production: `APP_ENV=production`, `APP_DEBUG=false`, a real `APP_URL`, `php artisan key:generate`, strong `DB_PASSWORD`, `REDIS_PASSWORD`.
- [ ] `TRUSTED_PROXIES` set if the app is behind a proxy or load balancer (otherwise rate limits see the proxy's address and signed attachment URLs do not validate).
- [ ] `CORS_ALLOWED_ORIGINS` and `REVERB_ALLOWED_ORIGINS` set to the frontend origin(s); new `REVERB_APP_ID/KEY/SECRET`; new `LIVEKIT_API_KEY/SECRET` (long and random).
- [ ] `php artisan migrate --force` (not `migrate:fresh`, and do not seed production).
- [ ] `php artisan storage:link`, then `php artisan config:cache route:cache event:cache`; run them again after every deploy.
- [ ] `php artisan push:vapid` once, keys saved in `.env`.

**Processes** (use Supervisor or systemd so they restart)
- [ ] PHP-FPM + nginx for the API.
- [ ] `php artisan queue:work redis --tries=3 --max-time=3600` — restart it on deploy with `php artisan queue:restart`.
- [ ] `php artisan reverb:start` behind a TLS proxy that forwards WebSocket upgrades (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).
- [ ] Cron: `* * * * * cd /var/www/kanyaw-connect && php artisan schedule:run >> /dev/null 2>&1`
- [ ] LiveKit with TLS and TURN, its webhook pointing at the API (see above).

**After deploying**
- [ ] `GET /up` answers `200`. `POST /auth/login` works. `php artisan schedule:list` shows the jobs.
- [ ] Send a message between two accounts and see it arrive in real time (proves the queue worker and Reverb).
- [ ] Join a video room from two devices on different networks, one on mobile data (proves TURN).
- [ ] `php artisan queue:failed` is empty after a few minutes.

## Project layout

```
app/Actions/       one class per business operation (SendMessage, JoinRoom, EndStaleRooms, …)
app/Services/      shared helpers (LiveKit, web push, presence, key bundles, broadcasting)
app/Http/          thin controllers, Form Requests (validation), API Resources (JSON shape), middleware
app/Policies/      authorisation rules (who may do what)
app/Events/        broadcast events (queued, dot-named: message.sent, room.ended, …)
app/Console/       artisan commands (scheduled housekeeping, VAPID keys)
config/            chat, rooms, e2ee, push, cleanup, security, cors, services (LiveKit)
database/          migrations (UUID keys), factories, seeder
docs/API.md        the API contract for the frontend
tests/             Feature (every endpoint), Unit (source scans, helpers), Integration (real parallel processes)
```

Conventions: UUID primary keys and `foreignUuid` everywhere; routes under `/api/v1`; validation only in Form Requests; authorisation only in policies; business logic in Actions and Services; lists use cursor pagination (30 by default, 100 at most); broadcast events are queued; rate limits are named limiters in `AppServiceProvider`; places where two requests could race use transactions and row locks.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Messages are sent but nobody receives them live | The queue worker (`queue:work`) or Reverb is not running |
| A video room never becomes `active`, seats are never freed | LiveKit cannot reach `/api/v1/webhooks/livekit`, or `LIVEKIT_API_SECRET` differs between LiveKit and `.env` |
| Joining a room answers `503` | LiveKit is not running or `LIVEKIT_HOST` is wrong |
| Attachment links answer `403` behind a proxy | `TRUSTED_PROXIES` is not set, so the signature was made for another scheme or host |
| Browser says "blocked by CORS" | The frontend origin is not in `CORS_ALLOWED_ORIGINS` (it must match scheme, host and port exactly), or the request sends a header that is not allowed |
| WebSocket refuses to connect | The frontend origin is not in `REVERB_ALLOWED_ORIGINS`, or the proxy does not forward `Upgrade` headers |
| No push notifications | No `VAPID_*` keys, no queue worker, the app is open (online users are skipped), the chat is muted, or the browser never subscribed (`GET /push/subscriptions`) |
| Users show as online for ever | The scheduler is not running (`presence:mark-offline`) |
| Large uploads fail | `upload_max_filesize` / `post_max_size` / nginx `client_max_body_size` are below 25 MB |
| `Class "Sodium…"` / `bcmath` errors | The `sodium` or `bcmath` PHP extension is missing |
| Pest prints nothing | See [Tests and code style](#tests-and-code-style) |
