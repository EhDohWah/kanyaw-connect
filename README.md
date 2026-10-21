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
| Web server | FrankenPHP (Caddy with PHP built in) |
| Tests, style | Pest, Laravel Pint |

**What it does:** accounts and profiles · one-to-one and group chats with roles · text, image, voice and file messages with replies, edits and deletes · read positions and unread counts · online presence and typing indicators · real-time delivery · video rooms with passwords, waiting rooms, locking, co-hosts, muting and removal · end-to-end encrypted chats (server side: a key directory and ciphertext relay) · web push notifications · a room audit log · scheduled clean-up.

## Contents

- [Quick start with Docker](#quick-start-with-docker)
- [Using the Docker stack](#using-the-docker-stack)
- [What runs in Docker](#what-runs-in-docker)
- [Docker settings](#docker-settings)
- [Using it from another device](#using-it-from-another-device)
- [Running without Docker](#running-without-docker)
- [Configuration](#configuration)
- [Scheduled jobs](#scheduled-jobs)
- [LiveKit and TURN](#livekit-and-turn)
- [Web push](#web-push)
- [End-to-end encryption](#end-to-end-encryption)
- [Security](#security)
- [Tests and code style](#tests-and-code-style)
- [Deploying with Docker](#deploying-with-docker)
- [Deployment checklist](#deployment-checklist)
- [Project layout](#project-layout)
- [Troubleshooting](#troubleshooting)

## Quick start with Docker

You need [Docker](https://docs.docker.com/get-docker/) with Compose **2.24 or newer** (Docker Desktop 4.27+ on Windows and macOS, or Docker Engine with the Compose plugin on Linux). Check with `docker compose version`. Nothing else: PHP, PostgreSQL, Redis, LiveKit and Composer all live in the containers.

From the project folder:

```bash
docker compose up -d --build
```

The first run builds the image, which takes several minutes (it compiles PHP extensions and downloads the packages). After that, starting everything takes about 15 seconds. It starts eight containers, creates the database, runs the migrations and adds demo people and chats.

Check that it works:

```bash
docker compose ps                  # every service "running" or "healthy"; migrate has "exited (0)", which is correct
curl localhost:8000/up             # the API answers
curl -s localhost:8000/api/v1/auth/login -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"email":"user1@example.com","password":"password","device_name":"curl"}'
```

In Windows PowerShell, `curl` is another command; use this instead:

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/v1/auth/login -ContentType 'application/json' `
  -Body '{"email":"user1@example.com","password":"password","device_name":"powershell"}'
```

The answer contains a token. Send it as `Authorization: Bearer <token>`, for example to `GET /api/v1/chats`.

**Demo accounts:** `user1@example.com` … `user5@example.com`, all with the password `password`. They come with two direct chats, a group chat with a few messages, and one scheduled video room. The demo data is only added to an *empty* database, never twice.

**What the frontend needs** (everything is on your own machine):

| Setting | Value |
|---|---|
| API base URL | `http://localhost:8000/api/v1` |
| Live updates (Reverb) | `VITE_REVERB_APP_KEY=local-dev-key`, `VITE_REVERB_HOST=localhost`, `VITE_REVERB_PORT=8080`, `VITE_REVERB_SCHEME=http` (names as in [docs/API.md, section 4.1](docs/API.md#41-connecting)). The same websocket also answers on port `8000`. |
| Video (LiveKit) | nothing to configure: the address comes back when joining a room (`livekit_url`, `ws://localhost:7880`) |

On a deployed server the websocket goes through the API's own address, so the frontend uses `VITE_REVERB_HOST=api.example.org`, `VITE_REVERB_PORT=443`, `VITE_REVERB_SCHEME=https`.

## Using the Docker stack

```bash
docker compose up -d --build        # start everything; also use this after you change code or pull new code
docker compose ps                   # what is running
docker compose logs -f app queue    # follow the logs of some services (all if you name none)
docker compose exec app php artisan route:list     # run any artisan command
docker compose exec app php artisan tinker
docker compose run --rm test        # run the test suite (uses its own database, see below)
docker compose exec postgres psql -U kanyaw kanyaw_connect     # a SQL prompt
docker compose down                 # stop everything; the data stays
docker compose down -v              # stop AND delete all data: database, Redis, uploaded files (a fresh start, with new demo data)
```

- **The code is inside the image.** After you edit PHP files run `docker compose up -d --build`. Only the last layers are rebuilt, so it takes seconds, and containers whose image changed are replaced.
- **To put the demo data back** without deleting the volumes: `docker compose exec app php artisan migrate:fresh --seed --force`. This empties the development database.
- **Logs** of the application go to `docker compose logs`, not to a file. The web server writes no access log, on purpose: signed attachment links contain a secret.
- **Running the tests inside Docker cannot touch your data.** `phpunit.xml` forces the separate `kanyaw_connect_test` database, and `tests/TestCase.php` stops the run if the database name does not end in `_test`.
- **Where the data lives:** named volumes `postgres-data`, `redis-data`, `storage` (uploaded files) and `caddy-data`. They survive `docker compose down` and rebuilds.

## What runs in Docker

One image (`Dockerfile`) is used for every PHP part of the app. A container's job is only the command it runs.

| Service | What it is | Address on your machine | Without it |
|---|---|---|---|
| `postgres` | PostgreSQL 16 | `127.0.0.1:5432` (only this machine) | Nothing works |
| `redis` | Redis 7: cache, queues, presence | `127.0.0.1:6379` (only this machine) | Nothing works |
| `migrate` | Runs once: migrations, and demo data in an empty database | none | The other services wait for it |
| `app` | The API (FrankenPHP: Caddy with PHP) | `http://localhost:8000` | No API |
| `reverb` | Real-time updates (websockets) | `ws://localhost:8080` and `ws://localhost:8000/app/...` | No live updates; the REST API still works |
| `queue` | Queue worker: publishes live events, sends push notifications, makes thumbnails | none | Live events never arrive, no push, no thumbnails |
| `scheduler` | Runs the [scheduled jobs](#scheduled-jobs) every minute | none | Users never go offline, clean-up never runs |
| `livekit` | Video (WebRTC) | `ws://localhost:7880`, `7881/tcp`, `7882/udp` | Nobody can join a video room (`503`) |
| `test` | The test suite; only started by `docker compose run --rm test` | none | |

The websocket is reachable at two addresses, with the same result: directly on Reverb's port (`ws://localhost:8080/app/<key>`) and through the API's web server (`ws://localhost:8000/app/<key>`). The second one means a deployed frontend needs only one domain and one certificate.

Leave `REDIS_QUEUE_BLOCK_FOR` at its default so the queue worker picks up events immediately instead of polling every few seconds.

## Docker settings

Everything has a working default, so **no `.env` file is needed**. To change something, copy `.env.example` to `.env` (next to `docker-compose.yml`) and edit it; run `docker compose up -d` afterwards. Any setting from [Configuration](#configuration) can go in it.

The containers find each other by name, so a few settings are fixed by `docker-compose.yml` and a `.env` written for running on your own machine (`DB_HOST=127.0.0.1`) does not break anything: `DB_CONNECTION`, `DB_HOST`, `DB_PORT`, `REDIS_*`, `CACHE_STORE`, `QUEUE_CONNECTION`, `SESSION_DRIVER`, `BROADCAST_CONNECTION`, `REVERB_HOST`, `REVERB_SCHEME`, `REVERB_SERVER_*`, `LIVEKIT_HOST` and `LOG_CHANNEL` are ignored in `.env`.

These settings are read by Docker only:

| Variable | Default | Meaning |
|---|---|---|
| `APP_PORT` | `8000` | Port of the API on your machine |
| `REVERB_PORT` | `8080` | Port of Reverb on your machine (the frontend connects to it) |
| `FORWARD_DB_PORT`, `FORWARD_REDIS_PORT` | `5432`, `6379` | Ports of PostgreSQL and Redis on your machine. Change one if your own database already uses it ("port is already allocated"). |
| `SEED_DEMO_DATA` | `true` | Add the demo people and chats to an **empty** database. `false` to start with nothing. |
| `LIVEKIT_NODE_IP` | `127.0.0.1` | The address browsers send video to. See [Using it from another device](#using-it-from-another-device). |
| `LIVEKIT_WEBHOOK_URL` | `http://app/api/v1/webhooks/livekit` | Where LiveKit reports who joined and left. Only change it when the app runs outside Docker. |
| `SERVER_NAME` | `:80` | Production only: the domain name. See [Deploying with Docker](#deploying-with-docker). |
| `LIVEKIT_DOMAIN` | | Production only: the domain name of the video server. |

`DB_DATABASE`, `DB_USERNAME` and `DB_PASSWORD` also create the database, so **changing `DB_PASSWORD` after the first start has no effect** on the existing data volume: the old password stays. Either use `docker compose down -v` (deletes the data) or change it inside the database too.

LiveKit's key and secret (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) come from the same place for the API and for LiveKit, so there is nothing to keep in step.

## Using it from another device

By default everything is built for a browser on the same machine (`localhost`). To use a phone or another computer on your network:

1. Find this machine's address on that network, for example `192.168.1.20`.
2. In `.env`: `APP_URL=http://192.168.1.20:8000`, `LIVEKIT_URL=ws://192.168.1.20:7880`, `LIVEKIT_NODE_IP=192.168.1.20`, and `CORS_ALLOWED_ORIGINS` set to the address the frontend is opened at.
3. `docker compose up -d`, and allow ports `8000`, `8080`, `7880`, `7881/tcp` and `7882/udp` through this machine's firewall.

Browsers only allow the camera and microphone on pages served over `https://` (or `localhost`), so a *video call* from a phone needs HTTPS, which means a real deployment (see [Deploying with Docker](#deploying-with-docker)). Chat works over plain `http://`.

## Running without Docker

Docker is the supported way. If you prefer to run PHP on your own machine you need PHP 8.3+ with the extensions `bcmath`, `curl`, `exif`, `gd`, `intl`, `mbstring`, `openssl`, `pcntl`, `pdo_pgsql`, `redis`, `sodium`, `zip`, Composer, PostgreSQL 16 and Redis. You can still use Docker for the databases and LiveKit:

```bash
cp .env.example .env
docker compose up -d postgres redis livekit     # or use your own Postgres 16 + Redis
composer install
php artisan key:generate
php artisan migrate:fresh --seed                # demo data. NEVER on a database with real data: it drops every table.
php artisan serve                               # http://localhost:8000
```

Then, each in its own terminal: `php artisan queue:work`, `php artisan reverb:start`, `php artisan schedule:work`. If LiveKit runs in Docker and the app on your machine, set `LIVEKIT_WEBHOOK_URL=http://host.docker.internal:8000/api/v1/webhooks/livekit` in `.env` before starting it. In production the queue worker, Reverb and the scheduler run under a process manager (see the [checklist](#deployment-checklist)).

## Configuration

Settings come from environment variables (`.env`). In production the Docker image reads them once at start (`config:cache`): nothing in the code reads `env()` outside the `config/` files, so this is safe. `.env.example` lists everything with development defaults.

### Application and database

| Variable | Default | Meaning |
|---|---|---|
| `APP_ENV`, `APP_DEBUG` | `local`, `true` | **In production use `production` and `false`.** With debug on, error responses include stack traces and file paths. |
| `APP_NAME` | `Karen Connect` | Name of the application. Also part of the prefix of cache and Redis keys. |
| `LOG_LEVEL` | `debug` | Least important message that is logged (`debug`, `info`, `warning`, `error`). The production compose file uses `info`. In Docker the log goes to `docker compose logs`. |
| `APP_URL` | `http://localhost:8000` | The public URL of the API. Signed attachment URLs are built from it. |
| `APP_KEY` | | Generate with `php artisan key:generate` (without Docker) or `openssl rand -base64 32` with `base64:` in front. In Docker, empty means "use the public development key", which is fine on your machine and never on a server. Losing the key makes stored push secrets unreadable. |
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
| `TRUSTED_PROXIES` | empty | Proxies whose `X-Forwarded-*` headers are trusted: `*` or comma separated IPs / CIDRs. **Required behind a reverse proxy or load balancer** (not needed with the production Docker setup, whose web server faces the internet itself). |
| `SECURITY_HSTS` | `true` | Send `Strict-Transport-Security` on HTTPS requests. |
| `API_RATE_LIMIT` | `300` | Requests per minute per signed-in user (flood backstop). |
| `REGISTER_RATE_LIMIT` | `20` | Sign-ups per hour per IP address. |

### Real-time (Reverb)

| Variable | Default | Meaning |
|---|---|---|
| `BROADCAST_CONNECTION` | `reverb` | |
| `REVERB_APP_ID`, `REVERB_APP_KEY`, `REVERB_APP_SECRET` | development values | Credentials of the Reverb application. **Change all three in production.** The key is public (the frontend uses it); the secret is not. |
| `REVERB_HOST`, `REVERB_PORT`, `REVERB_SCHEME` | `localhost`, `8080`, `http` | Where the API reaches Reverb (without Docker). In Docker the API uses `reverb:8080` and these are ignored; `REVERB_PORT` is then the port on your machine. |
| `REVERB_SERVER_HOST`, `REVERB_SERVER_PORT` | `0.0.0.0`, `8080` | What `reverb:start` listens on. |
| `REVERB_ALLOWED_ORIGINS` | `*` | **Host names** of the pages allowed to open a WebSocket, comma separated, wildcards allowed: `chat.example.org,*.example.org`. Not URLs: no `https://`, no port. Only the host of the browser's `Origin` is compared. A client that sends no `Origin` (some native apps) is refused unless this is `*`. Set it to your frontend's host in production. |
| `REVERB_MAX_REQUEST_SIZE` | `100000` | Largest event Reverb accepts, in bytes. 5000 Burmese or Karen characters are about 15 KB in UTF-8, so the library default of 10 KB is too small. |

### Video (LiveKit) and rooms

| Variable | Default | Meaning |
|---|---|---|
| `LIVEKIT_URL` | `ws://localhost:7880` | What **clients** connect to (`ws://` or `wss://`). |
| `LIVEKIT_HOST` | `http://localhost:7880` | What **the API** calls (`http://` or `https://`). Different on purpose: inside a private network it is usually an internal address. In Docker it is set for you. |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | development values | Must match the `keys:` entry in LiveKit's config (Docker development does that for you). The secret also signs webhooks. |
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

All run through the scheduler (the `scheduler` container, or `schedule:work` / a cron line without Docker). Times are Thailand time (Asia/Bangkok), so the heavy ones run in the quiet hours.

| Command | When | What |
|---|---|---|
| `presence:mark-offline` | every minute | Marks users offline when their heartbeat (90 s) has expired |
| `rooms:end-stale` | every 15 minutes | Ends video rooms that were left behind: never joined (a day after they were due), started but empty for an hour, or running for over 24 hours. Also closes them in LiveKit. |
| `attachments:purge-orphans` | hourly | Deletes uploads that were never attached to a message (older than 24 h), files included |
| `messages:purge-deleted` | daily 03:10 | Permanently removes messages deleted more than 30 days ago, with their attachment files and encrypted copies |
| `sanctum:prune-expired --hours=24` | daily 03:30 | Deletes expired login tokens (and with them the push subscriptions made under them) |
| `queue:prune-failed --hours=168` | daily 03:40 | Forgets failed jobs older than a week |

Each command can also be run by hand, for example `docker compose exec app php artisan messages:purge-deleted`; they print how much they removed and are safe to repeat. The longer jobs use `withoutOverlapping()` (a slow run never overlaps the next) and all but `presence:mark-offline` use `onOneServer()` (two servers do not both run it).

## LiveKit and TURN

Video runs on a self-hosted [LiveKit](https://livekit.io) server, which handles all WebRTC signalling, SDP and ICE. The API never touches media: it decides who may join and signs a token; the frontend connects to LiveKit with `livekit-client`.

**Development:** the `livekit` service in `docker-compose.yml` carries its whole configuration (written from `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and the other settings above). Media goes over the single UDP port `7882`, with `7881/tcp` as the fallback; both are published on your machine.

**The webhook is essential.** LiveKit reports who joined and left to `POST /api/v1/webhooks/livekit`; that is the **only** thing that sets `joined_at` / `left_at`, makes a room active, ends it when everyone has left, and moves the host role. Without it rooms never become active and seats are never freed. The `webhook:` section of LiveKit's config must point at the API, and the API must be reachable from the LiveKit server. The request is signed with the LiveKit secret and is rejected (`401`) otherwise. The Docker development stack sets this up (`http://app/api/v1/webhooks/livekit`).

**Production.** LiveKit needs a public address, TLS, and a **TURN server**. TURN relays media for people behind strict mobile or office firewalls, which is common for this audience; without it some calls will not connect. LiveKit has TURN built in, so no separate coturn is needed. `docker-compose.prod.yml` runs LiveKit on the host's network with a config file you write: copy `docker/livekit/livekit.production.example.yaml` to `docker/livekit/livekit.production.yaml` and fill it in. The example has not been run against a real deployment, so check it against LiveKit's current documentation:

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

Open these ports in the firewall: `80` and `443` (web server, including `wss://` for video), `7881/tcp`, `3478/udp`, `5349/tcp` (TURN over TLS), and the UDP range `50000-60000`. **Do not open `7880`**: the web server passes `wss://livekit.example.org` on to it. TURN over TLS needs a certificate for the TURN domain; get one with certbot or any other tool and make the files available inside the LiveKit container (add a volume line for it in your own compose override). A room that nobody is in is closed by LiveKit after `rooms.livekit_empty_timeout_seconds` (5 minutes), which the webhook turns into `status: ended`.

## Web push

Push notifications reach a phone whose app is closed. They need three things: the `VAPID_*` keys, the queue worker, and a frontend that registers a service worker (see section 6 of [docs/API.md](docs/API.md#6-guide-push-notifications)).

```bash
docker compose exec app php artisan push:vapid     # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT for your .env
```

Create the pair once and keep it: replacing it signs every browser out of push. Notifications are encrypted for the browser (the push service cannot read them) and only ever contain "New message" for encrypted chats. The server only talks to the well-known push services; a client cannot make it call an arbitrary address (see `PUSH_ALLOWED_HOSTS`).

## End-to-end encryption

In an encrypted chat the server is only a **key directory** and a **ciphertext relay**. It stores public keys and opaque encrypted blobs, and never receives a private key or any plaintext. A test scans the source to prove that no code decrypts or reads ciphertext. The details of the endpoints and rules are in [docs/API.md, section 5](docs/API.md#5-guide-end-to-end-encryption).

> **For the frontend.** Use a vetted protocol, not home-made crypto. As a minimum, libsodium `crypto_box` / sealed boxes; ideally a Double Ratchet library (Signal-style). Ed25519 *signing* keys and X25519 *exchange* keys are two separate key pairs: never derive one from the other ad hoc.

What the server can still see is metadata: who is in which chat, who sent a message and from which device, when, how big it is, and its type. Say so in the app's privacy text. PHP needs `ext-sodium` (it is part of PHP's core) only to verify the signature on signed prekeys.

## Security

- **Authentication:** bearer tokens that expire after 30 days and are not extended by use; one token per device; logging out revokes only that device. Login is limited to 5 attempts a minute per email and IP address, registration to 20 an hour per IP address, and every signed-in user to 300 requests a minute.
- **Authorisation** lives in policies and route middleware, which run before validation: a stranger gets `403` whatever they send. Some lookups answer `404` instead, so ids cannot be probed (other people's devices, messages of chats you are not in).
- **Headers:** every response has `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a restrictive `Content-Security-Policy`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`; HTTPS responses also carry `Strict-Transport-Security`. The server does not announce its software.
- **CORS** allows only the frontend origin(s) in `CORS_ALLOWED_ORIGINS`, with the headers the app uses (`Authorization`, `Content-Type`, `X-Device-Id`, `X-Socket-ID`).
- **Errors** never reveal stack traces, file paths or class names when `APP_DEBUG=false`.
- **Files:** attachments are private and served only through signed URLs that expire after an hour; the stored name comes from the file's content, never from the client; avatars exclude SVG.
- **Push endpoints:** only known browser push services are accepted, so the server cannot be aimed at internal addresses.
- **Audit log:** every action of a room host or co-host is recorded (who, what, to whom, when; no IP addresses) and readable by the host: `GET /rooms/{room}/audit-log`.
- **Secrets at rest:** passwords are hashed; room passwords are hashed; push auth secrets are encrypted with `APP_KEY`; end-to-end private keys never reach the server.
- **Containers:** the application runs as an unprivileged user. In production PostgreSQL, Redis and Reverb are not reachable from outside Docker, debug output is forced off, and compose refuses to start without your own secrets. The production image also refuses to start without an `APP_KEY`, the development image (which has test tools) refuses to run as production, and demo data is refused in production.

## Tests and code style

```bash
docker compose run --rm test          # in Docker (about two minutes)
```

Without Docker:

```bash
./vendor/bin/pest      # needs the kanyaw_connect_test database (docker compose creates it)
./vendor/bin/pint      # fixes style; add --test to only check
```

The suite has feature tests for every endpoint (happy path, `401`, `403`), concurrency tests that use real parallel processes (one-time prekeys can only be claimed once), source-scan tests (nothing decrypts ciphertext), and documentation tests: `docs/API.md` must list every route and every broadcast event, and its links and JSON examples must be valid; the README must explain every setting. LiveKit and web push are replaced by fakes in the tests, so no network is needed. GitHub Actions runs Pint and Pest on every push, and builds and starts the Docker stack (`.github/workflows/tests.yml`).

**The tests empty their database.** That is why `phpunit.xml` pins the test database and the test settings so that nothing in your shell or container can override them, and why the run stops with "Refusing to run the tests" if the database name does not end in `_test`.

If Pest ends with no output at all, a fatal PHP error is probably being swallowed by the `laravel/pao` output filter; run `PAO_DISABLE=1 ./vendor/bin/pest` to see it.

## Deploying with Docker

`docker-compose.prod.yml` turns the stack into a production setup. It was run and tested on a single machine (build, start, the full end-to-end checks, automatic HTTPS with a locally issued certificate), but **not on a public server**. Certificate issuance from the internet, TURN and real push services are untested, so treat the first deployment as a rehearsal and do the checks at the end of this section.

**What changes compared with development:** the production image (no test tools, code that cannot change, settings cached); no demo data, no debug output and no built-in keys, so every secret must be set; PostgreSQL, Redis and Reverb are not published; the web server gets HTTPS by itself for your domains; Reverb is reached through the same address (`wss://api.example.org/app/<key>`); LiveKit runs on the host's network; logs are rotated.

**You need:** a Linux server with Docker, DNS names pointing at its IP address (`api.example.org` for the API, `livekit.example.org` for video, `turn.example.org` for TURN), and the ports from [LiveKit and TURN](#livekit-and-turn) open.

1. Put the project on the server (`git clone`) and create `.env` with at least:

   ```bash
   APP_KEY=base64:...                 # base64: followed by the output of: openssl rand -base64 32
   APP_URL=https://api.example.org
   SERVER_NAME=api.example.org        # the web server requests the HTTPS certificate for this name
   FRONTEND_URL=https://chat.example.org
   CORS_ALLOWED_ORIGINS=https://chat.example.org
   REVERB_ALLOWED_ORIGINS=chat.example.org
   DB_PASSWORD=...                    # openssl rand -hex 24
   REVERB_APP_ID=...                  # any number, for example 424242
   REVERB_APP_KEY=...                 # openssl rand -hex 10
   REVERB_APP_SECRET=...              # openssl rand -hex 16
   LIVEKIT_DOMAIN=livekit.example.org
   LIVEKIT_URL=wss://livekit.example.org
   LIVEKIT_API_KEY=...                # any name, for example kc
   LIVEKIT_API_SECRET=...             # openssl rand -hex 24 (at least 32 characters)
   COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml    # so that you can type just "docker compose"
   ```

   Compose stops with a message naming any required setting that is missing.
2. Create the LiveKit config: `cp docker/livekit/livekit.production.example.yaml docker/livekit/livekit.production.yaml` and fill it in (the key and secret must be the same as in `.env`, the webhook URL is `https://api.example.org/api/v1/webhooks/livekit`).
3. `docker compose up -d --build`. The first start requests the certificates, so DNS must already point at the server.
4. Optional: `docker compose run --rm --no-deps app php artisan push:vapid`, and put the keys in `.env`.

**Check it:**
- `curl https://api.example.org/up` answers `200`; `docker compose ps` shows everything running.
- `POST /api/v1/auth/register` and `/login` work. Send a message between two accounts and see it arrive live (proves the queue worker and Reverb).
- Join a video room from two devices on different networks, one of them on mobile data (proves TURN and the firewall).
- `docker compose exec app php artisan queue:failed` is empty after a few minutes.

**Updating:** `git pull`, then `docker compose up -d --build`. Migrations run by themselves before the app restarts.

**Backups** (database and uploaded files; do it regularly and try a restore once):

```bash
docker compose exec -T postgres pg_dump -U kanyaw kanyaw_connect > backup.sql
docker run --rm -v kanyaw-connect_storage:/data -v "$PWD":/backup alpine tar czf /backup/storage.tgz -C /data .
# restore the database into an empty one:  docker compose exec -T postgres psql -U kanyaw -d kanyaw_connect < backup.sql
```

## Deployment checklist

For a deployment with Docker the section above covers most of this. The list is complete and also applies without Docker.

**Server and PHP**
- [ ] PHP 8.3+ with the extensions above (the Docker image has them); `upload_max_filesize` and `post_max_size` above 25 MB (the image sets `26M` and `30M`), or large uploads fail before Laravel sees them. Match `client_max_body_size` in nginx if you use it.
- [ ] PostgreSQL 16 and Redis 7, both reachable only from the app servers. Redis with persistence (`appendonly yes`, the Docker stack does this) so queued events survive a restart. Backups of the database **and** of `storage/app/private` (attachments; the `storage` volume in Docker).
- [ ] HTTPS everywhere; the API, Reverb and LiveKit each behind TLS.

**Application**
- [ ] `.env` for production: `APP_ENV=production`, `APP_DEBUG=false`, a real `APP_URL`, a real `APP_KEY`, strong `DB_PASSWORD`, `REDIS_PASSWORD` if Redis is reachable by anything else.
- [ ] `TRUSTED_PROXIES` set if the app is behind a proxy or load balancer (otherwise rate limits see the proxy's address and signed attachment URLs do not validate).
- [ ] `CORS_ALLOWED_ORIGINS` set to the frontend origin(s) and `REVERB_ALLOWED_ORIGINS` to the frontend host name(s); new `REVERB_APP_ID/KEY/SECRET`; new `LIVEKIT_API_KEY/SECRET` (long and random).
- [ ] `php artisan migrate --force` (not `migrate:fresh`, and do not seed production). The Docker stack does this on every start.
- [ ] Without Docker: `php artisan storage:link`, then `php artisan config:cache route:cache event:cache`; run them again after every deploy.
- [ ] `php artisan push:vapid` once, keys saved in `.env`.

**Processes** (Docker restarts them; otherwise use Supervisor or systemd)
- [ ] The API (FrankenPHP in Docker; PHP-FPM + nginx otherwise).
- [ ] `php artisan queue:work redis --tries=3 --max-time=3600` — restart it on deploy with `php artisan queue:restart`.
- [ ] `php artisan reverb:start` behind a TLS proxy that forwards WebSocket upgrades (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`). The Docker web server does this.
- [ ] The scheduler: the `scheduler` container, or the cron line `* * * * * cd /var/www/kanyaw-connect && php artisan schedule:run >> /dev/null 2>&1`.
- [ ] LiveKit with TLS and TURN, its webhook pointing at the API (see above).

**After deploying**
- [ ] `GET /up` answers `200`. `POST /auth/login` works. `php artisan schedule:list` shows the jobs.
- [ ] Send a message between two accounts and see it arrive in real time (proves the queue worker and Reverb).
- [ ] Join a video room from two devices on different networks, one on mobile data (proves TURN).
- [ ] `php artisan queue:failed` is empty after a few minutes.

## Project layout

```
Dockerfile                one image for every PHP part (targets: development, production)
docker-compose.yml        the whole stack for development: one command
docker-compose.prod.yml   production settings, added on top of the file above
docker/                   web server config (Caddyfile), PHP settings, start-up scripts, PostgreSQL and LiveKit files
app/Actions/              one class per business operation (SendMessage, JoinRoom, EndStaleRooms, …)
app/Services/             shared helpers (LiveKit, web push, presence, key bundles, broadcasting)
app/Http/                 thin controllers, Form Requests (validation), API Resources (JSON shape), middleware
app/Policies/             authorisation rules (who may do what)
app/Events/               broadcast events (queued, dot-named: message.sent, room.ended, …)
app/Console/              artisan commands (scheduled housekeeping, VAPID keys)
config/                   chat, rooms, e2ee, push, cleanup, security, cors, services (LiveKit)
database/                 migrations (UUID keys), factories, seeder
docs/API.md              the API contract for the frontend
tests/                    Feature (every endpoint), Unit (source scans, helpers), Integration (real parallel processes)
```

Conventions: UUID primary keys and `foreignUuid` everywhere; routes under `/api/v1`; validation only in Form Requests; authorisation only in policies; business logic in Actions and Services; lists use cursor pagination (30 by default, 100 at most); broadcast events are queued; rate limits are named limiters in `AppServiceProvider`; places where two requests could race use transactions and row locks.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `port is already allocated` / `address already in use` | Another program uses the port. Set `APP_PORT`, `REVERB_PORT`, `FORWARD_DB_PORT` or `FORWARD_REDIS_PORT` in `.env` to a free one (an existing PostgreSQL on 5432 is the usual one). |
| `docker compose up` says an `env_file` or `required` key is invalid | Compose is older than 2.24. Update Docker. |
| The first build is slow | It compiles PHP extensions and downloads packages (several minutes). Later builds reuse the cache. |
| A service is `unhealthy` or keeps restarting | `docker compose logs <service>`; `migrate` failing (it must exit with 0) stops the others from starting: `docker compose logs migrate` |
| `password authentication failed for user "kanyaw"` | `DB_PASSWORD` was changed after the database volume was created. Use the old one, or `docker compose down -v` (deletes the data). |
| Changed code, nothing changes | The code is inside the image: `docker compose up -d --build` |
| `No application encryption key has been specified` | Only without Docker: run `php artisan key:generate`. |
| Messages are sent but nobody receives them live | The queue worker (`queue`) or Reverb is not running: `docker compose ps`, `docker compose logs queue reverb` |
| A video room never becomes `active`, seats are never freed | LiveKit cannot reach `/api/v1/webhooks/livekit` (see `LIVEKIT_WEBHOOK_URL`), or `LIVEKIT_API_SECRET` differs between LiveKit and `.env` |
| Joining a room answers `503` | LiveKit is not running or `LIVEKIT_HOST` is wrong |
| Video connects but there is no sound or picture on another device | `LIVEKIT_NODE_IP` still says `127.0.0.1`; see [Using it from another device](#using-it-from-another-device). Behind a strict firewall: TURN is missing. |
| Attachment links answer `403` behind a proxy | `TRUSTED_PROXIES` is not set, so the signature was made for another scheme or host |
| Browser says "blocked by CORS" | The frontend origin is not in `CORS_ALLOWED_ORIGINS` (it must match scheme, host and port exactly), or the request sends a header that is not allowed |
| WebSocket refuses to connect (`Origin not allowed`) | The frontend's **host name** is not in `REVERB_ALLOWED_ORIGINS` (host names only, no `https://` and no port), or the proxy does not forward `Upgrade` headers |
| No push notifications | No `VAPID_*` keys, no queue worker, the app is open (online users are skipped), the chat is muted, or the browser never subscribed (`GET /push/subscriptions`) |
| Users show as online for ever | The scheduler is not running (`presence:mark-offline`) |
| Large uploads fail | `upload_max_filesize` / `post_max_size` / the proxy's body limit are below 25 MB |
| `Class "Sodium…"` / `bcmath` errors | Without Docker: the `sodium` or `bcmath` PHP extension is missing |
| Pest prints nothing | See [Tests and code style](#tests-and-code-style) |
