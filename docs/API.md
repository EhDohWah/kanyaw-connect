# Karen Connect — API reference

This is the contract between the Karen Connect backend and the frontend. It describes every HTTP endpoint, every real-time (WebSocket) event, and the rules the client has to follow. For installing and running the server, see the [README](../README.md).

Every example below was recorded from the running application, not written by hand. Ids, timestamps and secrets are replaced by stable placeholders. Long examples are shortened: lists are cut to their first item, and an object that was already shown in full under [Objects](#2-objects) may be left out of a later example (the text says so).

**Contents**

1. [Conventions](#1-conventions): authentication, errors, pagination, rate limits, headers
2. [Objects](#2-objects): the JSON shapes the API returns
3. [Endpoints](#3-endpoints): every route
4. [Real-time events](#4-real-time-events): channels and events, with payloads
5. [Guide: end-to-end encryption](#5-guide-end-to-end-encryption)
6. [Guide: push notifications](#6-guide-push-notifications)
7. [Guide: video rooms](#7-guide-video-rooms)
8. [Limits and enums](#8-limits-and-enums)

---

## 1. Conventions

### 1.1 Base URL and versioning

All routes are under `/api/v1`, for example `https://api.example.org/api/v1/chats`. In this document paths are written **without** that prefix: `GET /chats` means `GET /api/v1/chats`. A breaking change would be published as `/api/v2`; additions to `v1` only ever add fields, so ignore fields you do not know.

### 1.2 Authentication

The API uses bearer tokens (Laravel Sanctum). Everything except `POST /auth/register`, `POST /auth/login`, the signed attachment URLs and the LiveKit webhook needs:

```
Authorization: Bearer 1|Vb2xq9TnH7fKd4mYc8wZaLr3EoPj6UuS5iGtXe1N
```

- `POST /auth/login` returns a token and when it stops working (`expires_at`). **A token lasts 30 days from the day it was issued and is not extended by using it.** After that every request answers `401`: discard the token and show the login screen.
- Every login makes a separate token (name it with `device_name`), so a phone and a laptop never sign each other out. `POST /auth/logout` revokes only the token that made the request.
- A `401` always means "this token is no longer valid" (missing, expired, revoked). A `403` means you are signed in but not allowed.
- Signing out also stops push notifications on that browser (see [section 6](#6-guide-push-notifications)).

### 1.3 Requests

- Send `Accept: application/json` on every request.
- Bodies are JSON (`Content-Type: application/json`), except file uploads, which are `multipart/form-data`.
- Two optional headers matter:

| Header | When | Meaning |
|---|---|---|
| `X-Device-Id: <uuid>` | **Required** to send or read messages in an end-to-end encrypted chat; optional on `GET /chats`, `GET /chats/{chat}` and key-bundle requests | Which of *your* encryption devices is making the request. Must be one of your own active devices, otherwise `403`. It is not a secret and is never a substitute for the bearer token. |
| `X-Socket-ID: <id>` | Optional, on requests that change something | Your WebSocket connection id. The server will not echo the resulting event back to that connection. Laravel Echo adds it for you with axios; add it yourself with `fetch`. |

- **Idempotency.** `POST /chats/{chat}/messages` takes a client-generated `client_id` (a UUID). If a request is retried with the same `client_id` (a dropped connection, a double tap) the original message comes back with `200` instead of creating a second one. Generate the id when the user taps send and reuse it for every retry.

### 1.4 Responses

- A single resource is wrapped as `{ "data": { … } }`; a list as `{ "data": [ … ], "links": { … }, "meta": { … } }` (see pagination).
- `204 No Content` has no body.
- Ids are UUIDs (version 7, so they sort roughly by creation time; do not rely on it).
- Timestamps are ISO 8601 in **UTC**, with microseconds: `2026-03-14T09:00:00.000000Z`. Convert to the user's `timezone` for display. Messages sort by `(created_at, id)`.
- `settings` and `metadata` are always JSON **objects**, never arrays, even when empty.
- Fields not in this document may appear later. Ignore them.

### 1.5 Errors

Every error is JSON with a human-readable `message`:

```json
{ "message": "The room password is incorrect.", "errors": { "password": ["The room password is incorrect."] } }
```

- `errors` is present on `422` only: field name → list of messages (nested fields use dots: `keys.p256dh`, `envelopes.0.ciphertext`).
- Conflicts that a client may want to react to also carry a machine-readable `code` (list below). Show `message` to people, branch on `code` in code.
- In production an error never contains a stack trace, file names or class names.

| Status | Meaning |
|---|---|
| `400`/`405` | Malformed request / wrong HTTP method |
| `401` | Not signed in, or the token expired or was revoked |
| `403` | Signed in but not allowed (not a member, not the host, …) |
| `404` | Does not exist, **or you may not know that it exists** (other people's devices and push subscriptions, messages of chats you are not in, key bundles of people you share no chat with) |
| `409` | Valid request, but not possible right now. Has a `code`. |
| `413` | Upload larger than the web server accepts (the API's own limit is 25 MB, answered with `422`) |
| `422` | Validation failed. Has `errors`. |
| `429` | Too many requests. The `Retry-After` header says how many seconds to wait. |
| `500` | Server error. Message is always `"Server Error"`. |
| `503` | The video service (LiveKit) cannot be reached. Retry shortly. |

| `code` | Status | Where | Meaning |
|---|---|---|---|
| `room_ended` | 409 | join, lock, unlock | The room is over |
| `room_locked` | 409 | join | The host is not letting new people in |
| `room_full` | 409 | join | All seats are taken |
| `join_denied` | 403 | join | The host refused or removed you (a `403` from this endpoint may come without a `code`; the `message` says why) |
| `not_waiting` | 409 | deny | The person is not waiting to be let in |
| `participant_not_connected` | 409 | mute | The person is not in the call right now |
| `envelope_mismatch` | 409 | send (encrypted) | The envelopes do not match the members' devices. Also has `missing_device_ids` and `unexpected_device_ids`. |
| `no_recipient_devices` | 409 | send (encrypted) | Nobody else in the chat has set up encryption yet |

### 1.6 Pagination

Lists use **cursor pagination**: stable while new items arrive, cheap on slow connections.

- `?per_page=` sets the page size (default 30, maximum 100).
- The response has `links.next` (a full URL, or `null` on the last page) and `links.prev`, and `meta.next_cursor` / `meta.prev_cursor`.
- To load more, request `links.next` as it is, or pass `?cursor=<meta.next_cursor>`. Do not build cursors yourself.
- There are no page numbers and no totals.

```json
{
  "data": [ ],
  "links": { "first": null, "last": null, "prev": null, "next": "https://api.example.org/api/v1/chats/…/messages?cursor=eyJjcmVhdGVkX2F0IjoiMjAyNi0wMy0xNCAwOTowMDowMC4wMDAwMDAiLCJpZCI6IjAxOTVlMmM0LTAwMGEtN2EwOS04MTA5LTVmM2E5YzAxMTY2NyIsIl9wb2ludHNUb05leHRJdGVtcyI6dHJ1ZX0" },
  "meta": { "path": "https://api.example.org/api/v1/chats/…/messages", "per_page": 30, "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0wMy0xNCAwOTowMDowMC4wMDAwMDAiLCJpZCI6IjAxOTVlMmM0LTAwMGEtN2EwOS04MTA5LTVmM2E5YzAxMTY2NyIsIl9wb2ludHNUb05leHRJdGVtcyI6dHJ1ZX0", "prev_cursor": null }
}
```

Message lists are **newest first**; chat lists are most recently active first.

### 1.7 Rate limits

Limits are per signed-in user unless stated. A request over the limit gets `429` with a `Retry-After` header; successful responses carry `X-RateLimit-Limit` and `X-RateLimit-Remaining` for the limit that applies to that route.

| Action | Limit |
|---|---|
| Any signed-in request (backstop) | 300 / minute |
| `POST /auth/login` | 5 / minute per email + IP address |
| `POST /auth/register` | 20 / hour per IP address |
| `POST /chats/{chat}/messages` | 30 / minute |
| `POST /me/heartbeat` | 12 / minute |
| `POST /rooms/{room}/join` | 20 / minute per room |
| `POST /devices` | 20 / hour |
| `GET /users/{user}/key-bundles` | 10 / minute per target user |
| `POST /push/subscriptions` | 30 / hour |

### 1.8 Browser access (CORS) and security headers

- The server allows cross-origin requests from the configured frontend origin(s) only (`CORS_ALLOWED_ORIGINS`). Allowed request headers: `Accept`, `Authorization`, `Content-Type`, `X-Requested-With`, `X-Device-Id`, `X-Socket-ID`. `Retry-After` and the rate-limit headers are readable by scripts. Preflight answers are cached for 10 minutes. Cookies are not used (`supports_credentials` is off).
- Attachment URLs are also reachable cross-origin, so a client can `fetch()` an encrypted attachment and decrypt it in the browser.
- Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, a locked-down `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (HTTPS requests also get `Strict-Transport-Security`). Do not expect to cache API responses in the browser; keep your own state.

### 1.9 Working on slow or unstable connections

- Make every send retry-safe with `client_id` and show the message at once ("optimistic" UI); mark it failed only after your own retries give up.
- After a reconnect, do not replay missed events: fetch `GET /chats` (and `GET /chats/{chat}/messages` for the open chat) and merge by `id`.
- Page sizes of 20–30 keep responses small. Thumbnails exist so lists do not download full images.
- Send `POST /me/heartbeat` every 30–60 seconds only while the app is visible; back off on `429`.
- Real-time events can arrive twice or out of order; handle them idempotently (compare `id`s and timestamps).

## 2. Objects

The JSON shapes used throughout. Fields marked *only sometimes* are described where they appear.

### User (your own profile)

Returned by `/auth/*` and `/me*`. Contains private fields (email, phone, settings): other people never receive it.

```json
{
  "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
  "name": "Saw Eh Doh",
  "email": "eh@example.org",
  "phone": "+66 81 234 5678",
  "email_verified_at": null,
  "avatar_url": null,
  "avatar_thumb_url": null,
  "status": "offline",
  "last_seen_at": null,
  "timezone": "Asia/Bangkok",
  "locale": "en",
  "settings": {},
  "created_at": "2026-03-14T09:00:00.000000Z"
}
```

| Field | Notes |
|---|---|
| `status` | `online`, `away`, `busy` or `offline`. Set by `POST /me/heartbeat`; falls back to `offline` when heartbeats stop. |
| `last_seen_at` | Last heartbeat, or `null` |
| `timezone` | IANA zone, default `Asia/Bangkok` |
| `locale` | `en`, `my` (Burmese) or `ksw` (S'gaw Karen); default `en` |
| `settings` | Free-form object for client preferences (max 50 top-level keys). Updates are merged key by key. |
| `avatar_url`, `avatar_thumb_url` | Absolute URLs, or `null`. The thumbnail is a 256×256 WebP. |

### PublicUser

How *other* people appear (chat members, senders, room hosts). Never has an email, phone number or settings.

```json
{
  "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
  "name": "Naw Paw Say",
  "avatar_url": null,
  "avatar_thumb_url": null
}
```

### Chat

Returned by the chat endpoints. `GET /chats` rows have everything except `members`; `GET /chats/{chat}` and the endpoints that change a chat add `members`.

```json
{
  "id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
  "type": "direct",
  "name": null,
  "description": null,
  "avatar_url": null,
  "is_encrypted": false,
  "member_count": 2,
  "last_message_at": "2026-03-14T09:00:46.209458Z",
  "created_at": "2026-03-14T09:01:09.314187Z",
  "unread_count": 0,
  "my_membership": {
    "role": "member",
    "joined_at": "2026-03-14T09:00:46.209458Z",
    "last_read_message_id": null,
    "last_read_at": "2026-03-14T09:00:46.209458Z",
    "is_muted": false,
    "muted_until": null,
    "is_archived": false,
    "pin_position": null
  },
  "latest_message": null,
  "other_user": {
    "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "name": "Naw Paw Say",
    "avatar_url": null,
    "avatar_thumb_url": null
  },
  "members": [
    {
      "user": {
        "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
        "name": "Saw Eh Doh",
        "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
        "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
      },
      "user_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
      "role": "member",
      "joined_at": "2026-03-14T09:00:46.209458Z"
    }
  ]
}
```

| Field | Notes |
|---|---|
| `type` | `direct` (two people) or `group` |
| `name`, `description` | `null` for direct chats; use `other_user` instead |
| `is_encrypted` | Fixed when the chat is created. See [section 5](#5-guide-end-to-end-encryption). |
| `member_count` | Current number of members |
| `last_message_at` | Time of the latest message; chats are sorted by it |
| `unread_count` | Messages from others after your read position (system messages and your own do not count) |
| `my_membership` | Your own role and settings in this chat (below) |
| `latest_message` | A [Message](#message) or `null`. In an encrypted chat it has `content: null`, and `envelope` only if you sent `X-Device-Id`. |
| `other_user` | Direct chats only: the person you are talking to |
| `members` | Only on single-chat responses: `[{ user, user_id, role, joined_at }]` |

`my_membership.role` is `owner`, `admin` or `member`. Direct chats have only `member`. `is_muted`, `muted_until`, `is_archived` and `pin_position` are stored per member and returned for the client to use; `is_muted` also stops push notifications for that chat.

### Message

```json
{
  "id": "0195e2c4-000a-7a09-8109-5f3a9c011667",
  "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
  "sender": {
    "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "name": "Saw Eh Doh",
    "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
    "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
  },
  "sender_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
  "type": "text",
  "content": "Yes, I will bring the documents.",
  "reply_to_id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
  "reply_to": {
    "id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
    "sender_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "type": "text",
    "content": "Hello Eh Doh, are you coming on Saturday?",
    "is_deleted": false
  },
  "client_id": "0195e2c4-0009-7a08-8108-5f3a9c00f778",
  "is_edited": false,
  "edited_at": null,
  "metadata": {},
  "encrypted": false,
  "attachment": null,
  "created_at": "2026-03-14T09:02:41.733103Z"
}
```

| Field | Notes |
|---|---|
| `type` | `text`, `image`, `file`, `voice` or `system`. Only the first four can be sent. `system` messages are written by the server (for example "X started a video room"; `metadata.event` is `room_created` and `metadata.room_id` / `metadata.host_id` say which). Render system messages from `metadata`; `content` is an English fallback. |
| `sender`, `sender_id` | `null` for system messages |
| `content` | Text or caption. **Always `null` in an encrypted chat.** |
| `reply_to` | A small preview of the message replied to: `{ id, sender_id, type, content, is_deleted }`. `content` is cut to 140 characters and is `null` when the original was deleted. |
| `client_id` | Only present on messages **you** sent: the idempotency key you chose |
| `is_edited`, `edited_at` | Text can be edited by its sender for 24 hours. Encrypted messages cannot be edited. |
| `metadata` | Object. `attachment_id` for media messages; `sender_device_id` for encrypted ones. A `voice` message may also carry `duration_ms` and `waveform` as its sender measured them (display hints, see [sending](#post-chatschatmessages)); either can be missing. |
| `encrypted` | `true` for messages in encrypted chats |
| `envelope` | Encrypted chats only, see [Envelope](#envelope) |
| `attachment` | An [Attachment](#attachment) for `image`, `file` and `voice` messages, otherwise `null` |

A deleted message disappears from lists and everywhere else; replies to it show `reply_to.is_deleted: true`.

### Attachment

```json
{
  "id": "0195e2c4-000d-7a0c-810c-5f3a9c017334",
  "original_name": "agenda.png",
  "mime_type": "image/png",
  "size": 1497,
  "url": "https://api.example.org/api/v1/attachments/0195e2c4-000d-7a0c-810c-5f3a9c017334/file?expires=1773478800&signature=3f9a1c7e5b2d8046a1e7c93b5d0f284a6e1b97c3d50a8f42e6b1c9d7a3e05f81",
  "thumbnail_url": "https://api.example.org/api/v1/attachments/0195e2c4-000d-7a0c-810c-5f3a9c017334/thumbnail?expires=1773478800&signature=3f9a1c7e5b2d8046a1e7c93b5d0f284a6e1b97c3d50a8f42e6b1c9d7a3e05f81",
  "created_at": "2026-03-14T09:00:00.000000Z"
}
```

`url` and `thumbnail_url` are signed, absolute and valid for 60 minutes; they work without a bearer token, so they can go straight into `<img src>` or `<audio src>`. Fetch the message again for fresh ones. `thumbnail_url` is `null` for anything that is not a raster image, and for the first moments after an upload while the thumbnail is being made. In an encrypted chat the file is an opaque blob: `mime_type` is always `application/octet-stream`, `original_name` is `attachment`, there is no thumbnail, and `encrypted_key` returns whatever the uploader attached.

### Envelope

One device's encrypted copy of a message. The server stores and returns it exactly as sent and cannot read it.

```json
{
  "recipient_device_id": "0195e2c4-0013-7a12-8112-5f3a9c022cce",
  "ciphertext": "ieVU35QoP8ItebCI/aBYJBgzudFT8lhpO+ofXSe0C7t2m+ZWn7vrm7rLyII1rB+pxvDDa4tt4sc4bIbf",
  "header": { "alg": "x25519-xsalsa20-poly1305", "nonce": "eVNKS2Cryl3VEslVCU0n/99rzd1EcsPZ", "ephemeral_key": "tuTfv9ZshvrZWSOg7Ws3RFCzBQEqJTKrS1bboyf74Dw=", "prekey_id": 7 }
}
```

### Device

An end-to-end encryption device owned by the signed-in user. Public keys only.

```json
{
  "id": "0195e2c4-0012-7a11-8111-5f3a9c020ddf",
  "name": "Pixel 7",
  "identity_public_key": "2dC1AxOZriYejXJpv4fMNjnpvFrfh5ELwymUCZSTNck=",
  "exchange_public_key": "5bCi+WAfYmZ4hKbti67C8AOdX/weLOT7eBAN3/GCm0Y=",
  "signed_prekey": {
    "id": 1,
    "public_key": "LT78lV3PTPtUctWE0oxS3ERZtz35Z9H9m+t5bwBxK0k=",
    "signature": "i0fjqbl9Tw7NA2ItQMSirgNSUkf6SJKICh/MRdWsegrJ7melC8hUVu+3JFSuXyKDK3Tj3jx4s8W4yVvfP2psAQ==",
    "rotated_at": "2026-03-14T09:04:36.256748Z"
  },
  "unclaimed_prekeys": 20,
  "last_active_at": "2026-03-14T09:04:59.361477Z",
  "created_at": "2026-03-14T09:05:22.466206Z"
}
```

### Key bundle

What you need to start an encrypted session with one device of another person.

```json
[
  {
    "device_id": "0195e2c4-0013-7a12-8112-5f3a9c022cce",
    "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "identity_public_key": "JdAFK9J0qkGrppR+fqku+yE5bnYIHdblzmYli8MczaQ=",
    "exchange_public_key": "g7fZQw2msS9EUjU1tVJ8IVSibOHNRAo7gp6C2Jm3JBg=",
    "signed_prekey": {
      "id": 1,
      "public_key": "v1dNy1rAKlQlNkGqySlRAf6oe0ypxI6c8H0MuAbG9As=",
      "signature": "+ZEH5/2sRCipTqeeSj2h9SETF6migQdM4lLt8MxdzImziKWCcGXHB8M5+bzDaGYgc9nUuaL+69TBpnJFL+r5Cw=="
    },
    "one_time_prekey": {
      "id": 1,
      "public_key": "ttBq4kc8b2/eZFSHP1Kplgi7EdmC08inu3Vo2QAi6wk="
    }
  }
]
```

### Push subscription

```json
{
  "id": "0195e2c4-0019-7a18-8118-5f3a9c02e668",
  "endpoint": "https://fcm.googleapis.com/fcm/send/dAbC12-example",
  "created_at": "2026-03-14T09:08:26.304038Z"
}
```

### Room

```json
{
  "id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
  "type": "scheduled",
  "name": "Committee meeting",
  "description": "Monthly planning call",
  "host": {
    "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "name": "Saw Eh Doh",
    "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
    "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
  },
  "host_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
  "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
  "has_password": true,
  "waiting_room_enabled": true,
  "is_locked": false,
  "max_participants": 20,
  "scheduled_at": "2026-03-14T09:09:35.618225Z",
  "duration_minutes": 60,
  "status": "waiting",
  "started_at": null,
  "ended_at": null,
  "recording_enabled": false,
  "created_at": "2026-03-14T09:09:58.722954Z",
  "present_count": 0,
  "my_participation": {
    "role": "host",
    "admission": "admitted"
  },
  "waiting_participants": [
    {
      "user": {
        "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
        "name": "Naw Paw Say",
        "avatar_url": null,
        "avatar_thumb_url": null
      },
      "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
      "role": "participant",
      "admission": "waiting",
      "joined_at": null,
      "left_at": null
    }
  ]
}
```

| Field | Notes |
|---|---|
| `type` | `instant` or `scheduled` (has `scheduled_at`) |
| `status` | `waiting` (nobody has joined yet), `active` or `ended` |
| `has_password` | The password itself is never returned |
| `waiting_room_enabled` | New people wait until a host or co-host admits them |
| `is_locked` | The host is not letting new people in; people already admitted can reconnect |
| `max_participants` | 2–100, default 50 |
| `present_count` | People connected right now, according to LiveKit |
| `my_participation` | `{ role, admission }` or `null` if you never asked to join. `role` is `host`, `co_host` or `participant`; `admission` is `waiting`, `admitted` or `denied`. |
| `waiting_participants` | Only for the host and co-hosts: a list of [Room participant](#room-participant) |
| `recording_enabled` | Always `false`: recording is not implemented |

### Room participant

```json
{
  "user": { "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde", "name": "Naw Paw Say", "avatar_url": null, "avatar_thumb_url": null },
  "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
  "role": "participant",
  "admission": "waiting",
  "joined_at": null,
  "left_at": null
}
```

`joined_at` and `left_at` are set only from LiveKit's own reports of who is connected.

### Audit entry

```json
{
  "id": "0195e2c4-001c-7a1b-811b-5f3a9c034335",
  "action": "room.participant_removed",
  "actor": {
    "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "name": "Saw Eh Doh",
    "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
    "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
  },
  "target": {
    "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "name": "Naw Paw Say",
    "avatar_url": null,
    "avatar_thumb_url": null
  },
  "metadata": {},
  "created_at": "2026-03-14T09:10:21.827683Z"
}
```

## 3. Endpoints

Each endpoint lists who may call it, the request, and the response. "Members" means members of the chat in the path. Unless stated, a request without a valid token gets `401`.

### 3.1 Authentication

### POST /auth/register

Create an account. It does **not** sign the person in: call `POST /auth/login` next.

**Auth:** none. **Limit:** 20 per hour per IP address.

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, max 255 |
| `email` | string | required, valid, max 255, unique (not case sensitive) |
| `password` | string | required, min 8 characters |
| `password_confirmation` | string | required, must match |
| `phone` | string | optional, 6–20 characters: digits, spaces, `-`, optional leading `+`; unique |

**Response `201`:** a [User](#user-your-own-profile).

```json
{
  "data": {
    "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "name": "Saw Eh Doh",
    "email": "eh@example.org",
    "phone": "+66 81 234 5678",
    "email_verified_at": null,
    "avatar_url": null,
    "avatar_thumb_url": null,
    "status": "offline",
    "last_seen_at": null,
    "timezone": "Asia/Bangkok",
    "locale": "en",
    "settings": {},
    "created_at": "2026-03-14T09:00:00.000000Z"
  }
}
```

**Errors:** `422` with `errors` per field.

```json
{
  "message": "The name field is required. (and 3 more errors)",
  "errors": {
    "name": [
      "The name field is required."
    ],
    "email": [
      "The email field must be a valid email address."
    ],
    "password": [
      "The password field confirmation does not match."
    ]
  }
}
```

### POST /auth/login

Exchange credentials for a bearer token.

**Auth:** none. **Limit:** 5 attempts per minute per email and IP address, then `429`.

| Field | Type | Rules |
|---|---|---|
| `email` | string | required |
| `password` | string | required |
| `device_name` | string | optional, max 255. Names the token ("Pixel 7"); default `api`. |

**Response `200`:**

```json
{
  "token": "1|Vb2xq9TnH7fKd4mYc8wZaLr3EoPj6UuS5iGtXe1N",
  "expires_at": "2026-04-13T09:00:00+00:00"
}
```

`token` is shown once; store it securely. `expires_at` is when it stops working (30 days). `user` is a [User](#user-your-own-profile).

**Errors:** `422` with `errors.email` for a wrong email or password (the same message for both, on purpose); `429` after too many attempts.

### POST /auth/logout

Revoke the token used for this request (other devices stay signed in). Browser push subscriptions made with this token are removed too.

**Response `200`:** `{ "message": "Logged out." }`

### 3.2 Profile and presence

### GET /me

The signed-in user. **Response `200`:** `{ "data": User }`.

### PATCH /me

Change your profile. Send only what you want to change.

| Field | Type | Rules |
|---|---|---|
| `name` | string | max 255, not empty |
| `phone` | string or null | as at registration; `null` removes it |
| `timezone` | string | an IANA time zone, e.g. `Asia/Bangkok` |
| `locale` | string | `en`, `my` or `ksw` |
| `settings` | object | max 50 keys. **Merged key by key** into the stored settings: send `{ "theme": "dark" }` to change one key and keep the others. To clear a value, set it to `null` (the key stays, with a `null` value). |

Email cannot be changed here.

```json
{
  "name": "Saw Eh Doh",
  "timezone": "Asia/Bangkok",
  "locale": "en",
  "settings": {
    "theme": "dark",
    "notifications": {
      "sound": true
    }
  }
}
```

**Response `200`:** `{ "data": User }`.

### POST /me/avatar

Upload a profile picture. `multipart/form-data` with one field, `avatar`: JPEG, PNG or WebP, at most 2 MB and 6000×6000 pixels (SVG is refused). The server keeps the original and makes a 256×256 WebP thumbnail.

**Response `200`:** `{ "data": User }` with the new `avatar_url` and `avatar_thumb_url`.

### POST /me/heartbeat

Tell the server the app is open. Call it every 30–60 seconds while the app is visible. Marks you `online` (or the status you send) and refreshes `last_seen_at`; if you stop, you read as `offline` after 90 seconds.

**Limit:** 12 per minute.

| Field | Type | Rules |
|---|---|---|
| `status` | string | optional: `online`, `away` or `busy`. Without it, an offline user becomes `online` and anyone else keeps their status. |

**Response `204`.**

### GET /users/presence

Who is online. Pass up to 100 user ids as `ids[]`. Only you and people you share a chat with are returned; other ids are silently left out, so this cannot be used to look up strangers.

`GET /users/presence?ids[]=0195e2c4-0003-7a02-8102-5f3a9c003dde&ids[]=0195e2c4-0001-7a00-8100-5f3a9c000000`

```json
{
  "data": [
    {
      "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
      "status": "online",
      "last_seen_at": "2026-03-14T09:00:00.000000Z"
    }
  ]
}
```

A user whose heartbeat has lapsed is reported `offline` even if their stored status says otherwise.

### 3.3 Chats

Everything under `/chats/{chat}` is for members only: anyone else gets `403`, whatever they send.

### GET /chats

Your chats, most recently active first. Each row is a [Chat](#chat) without `members`: it includes `latest_message`, `unread_count`, `my_membership` and, for direct chats, `other_user`. Cursor-paginated ([1.6](#16-pagination)); one request however many chats you have, so it is safe to call after every reconnect.

Optional header `X-Device-Id`: if you send it, `latest_message.envelope` is filled in for encrypted chats so the list can show previews; without it the envelope is left out.

```json
{
  "data": [
    {
      "id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
      "type": "group",
      "name": "Community committee",
      "description": "Planning and announcements",
      "avatar_url": null,
      "is_encrypted": false,
      "member_count": 3,
      "last_message_at": "2026-03-14T09:03:04.837832Z",
      "created_at": "2026-03-14T09:01:55.523645Z",
      "unread_count": 0,
      "my_membership": {
        "role": "owner",
        "joined_at": "2026-03-14T09:01:32.418916Z",
        "last_read_message_id": "0195e2c4-000c-7a0b-810b-5f3a9c015445",
        "last_read_at": "2026-03-14T09:03:04.837832Z",
        "is_muted": false,
        "muted_until": null,
        "is_archived": false,
        "pin_position": null
      },
      "latest_message": {
        "id": "0195e2c4-000c-7a0b-810b-5f3a9c015445",
        "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
        "sender": {
          "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
          "name": "Saw Eh Doh",
          "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
          "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
        },
        "sender_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
        "type": "text",
        "content": "Welcome everyone to the committee chat.",
        "reply_to_id": null,
        "client_id": "0195e2c4-000b-7a0a-810a-5f3a9c013556",
        "is_edited": false,
        "edited_at": null,
        "metadata": {},
        "encrypted": false,
        "attachment": null,
        "created_at": "2026-03-14T09:03:04.837832Z"
      }
    }
  ],
  "links": {
    "first": null,
    "last": null,
    "prev": null,
    "next": null
  },
  "meta": {
    "path": "https://api.example.org/api/v1/chats",
    "per_page": 30,
    "next_cursor": null,
    "prev_cursor": null
  }
}
```

### POST /chats/direct

Start (or reopen) a one-to-one chat. There is only ever one plaintext direct chat between two people, and one encrypted one.

| Field | Type | Rules |
|---|---|---|
| `user_id` | uuid | required, an existing user other than yourself |
| `is_encrypted` | boolean | optional, default `false`. **Cannot be changed later.** |

**Response `201`** with the new chat, or **`200`** with the chat that already existed: `{ "data": Chat }`. Everyone involved except the creator hears about a new chat on their `private-user` channel ([`chat.member_added`](#chatmember_added)).

### POST /chats/group

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, max 100 |
| `description` | string | optional, max 1000 |
| `member_ids` | uuid[] | required, 1–255 distinct existing users. **Do not include yourself:** you become the owner. |
| `is_encrypted` | boolean | optional, default `false`. Cannot be changed later. |

```json
{
  "name": "Community committee",
  "description": "Planning and announcements",
  "member_ids": [
    "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "0195e2c4-0005-7a04-8104-5f3a9c007bbc"
  ]
}
```

**Response `201`:** `{ "data": Chat }` including `members`.

### GET /chats/{chat}

One chat with its full `members` list. Optional `X-Device-Id` as for the list.

```json
{
  "role": "member",
  "joined_at": "2026-03-14T09:00:46.209458Z",
  "last_read_message_id": "0195e2c4-000a-7a09-8109-5f3a9c011667",
  "last_read_at": "2026-03-14T09:02:41.733103Z",
  "is_muted": false,
  "muted_until": null,
  "is_archived": false,
  "pin_position": null
}
```

(The example shows `my_membership` only; the response is a full [Chat](#chat) plus `members`.)

### PATCH /chats/{chat}

Rename a group or change its description. **Who:** group owner or admins.

| Field | Type | Rules |
|---|---|---|
| `name` | string | max 100, not empty |
| `description` | string or null | max 1000 |

**Response `200`:** `{ "data": Chat }`. Everyone hears [`chat.updated`](#chatupdated).

### DELETE /chats/{chat}/leave

Leave a group. **Response `204`.** Direct chats cannot be left (`403`). If the owner leaves, ownership passes to the longest-standing admin, otherwise the longest-standing member; when the last person leaves the chat is deleted.

### POST /chats/{chat}/read

Say how far you have read. The position only ever moves **forward**, so a slow request with an older message id cannot make read messages unread again.

| Field | Type | Rules |
|---|---|---|
| `message_id` | uuid | required; a message of this chat (it may since have been deleted) |

```json
{
  "message_id": "0195e2c4-000a-7a09-8109-5f3a9c011667"
}
```

**Response `200`:**

```json
{
  "data": {
    "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
    "last_read_message_id": "0195e2c4-000a-7a09-8109-5f3a9c011667",
    "last_read_at": "2026-03-14T09:02:41.733103Z",
    "unread_count": 0
  }
}
```

Your other devices hear [`message.read`](#messageread) on your `private-user` channel and clear their badge.

### 3.4 Group members

### POST /chats/{chat}/members

Add people to a group. **Who:** owner or admins. People already in the group are skipped. A group has at most 256 members. New members cannot read messages sent before they joined in an encrypted chat.

| Field | Type | Rules |
|---|---|---|
| `user_ids` | uuid[] | required, 1–50 distinct existing users |

**Response `200`:** `{ "data": Chat }`.

### PATCH /chats/{chat}/members/{user}

Change someone's role. **Who:** the owner only. The owner's own role cannot be changed.

| Field | Type | Rules |
|---|---|---|
| `role` | string | `admin` or `member` |

**Response `200`:** `{ "data": Chat }`. `404` if that user is not in the chat.

### DELETE /chats/{chat}/members/{user}

Remove someone from a group. **Who:** the owner can remove anyone; admins can remove plain members. To leave yourself use `DELETE /chats/{chat}/leave`. **Response `204`.** The removed person hears [`chat.member_removed`](#chatmember_removed).

### 3.5 Messages

### GET /chats/{chat}/messages

The chat's messages, **newest first**, cursor-paginated. Soft-deleted messages are not listed.

In an encrypted chat the `X-Device-Id` header is **required** and every message carries only that device's own `envelope` (`null` when your device cannot read it: it sent the message itself, or was added later).

```json
{
  "data": [
    {
      "id": "0195e2c4-000a-7a09-8109-5f3a9c011667",
      "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
      "sender": {
        "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
        "name": "Saw Eh Doh",
        "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
        "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
      },
      "sender_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
      "type": "text",
      "content": "Yes, I will bring the documents.",
      "reply_to_id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
      "reply_to": {
        "id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
        "sender_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
        "type": "text",
        "content": "Hello Eh Doh, are you coming on Saturday?",
        "is_deleted": false
      },
      "client_id": "0195e2c4-0009-7a08-8108-5f3a9c00f778",
      "is_edited": false,
      "edited_at": null,
      "metadata": {},
      "encrypted": false,
      "attachment": null,
      "created_at": "2026-03-14T09:02:41.733103Z"
    }
  ],
  "links": {
    "first": null,
    "last": null,
    "prev": null,
    "next": null
  },
  "meta": {
    "path": "https://api.example.org/api/v1/chats/0195e2c4-0004-7a03-8103-5f3a9c005ccd/messages",
    "per_page": 30,
    "next_cursor": null,
    "prev_cursor": null
  }
}
```

### POST /chats/{chat}/messages

Send a message. **Limit:** 30 per minute.

| Field | Type | Rules |
|---|---|---|
| `client_id` | uuid | required. Your idempotency key. |
| `type` | string | required: `text`, `image`, `file` or `voice` |
| `content` | string | required for `text`; optional caption for the others; max 5000 characters. **Not allowed in an encrypted chat.** |
| `reply_to_id` | uuid | optional; a message of the same chat that is not deleted |
| `metadata.attachment_id` | uuid | required for `image`, `file`, `voice`: an [attachment you uploaded](#post-chatschatattachments) to this chat and have not used yet. An `image` needs an `image/*` file and a `voice` message an `audio/*` file. |
| `metadata.duration_ms` | integer | `voice` only, optional: 1–600000, the recording's length in milliseconds. A JSON number, not a string. |
| `metadata.waveform` | array | `voice` only, optional: 16–64 integers, each 0–255, the loudness along the recording, for drawing it before it is downloaded. |
| `envelopes` | array | **Encrypted chats only**, required. See [section 5](#5-guide-end-to-end-encryption). |

```json
{
  "client_id": "0195e2c4-0009-7a08-8108-5f3a9c00f778",
  "type": "text",
  "content": "Yes, I will bring the documents.",
  "reply_to_id": "0195e2c4-0008-7a07-8107-5f3a9c00d889"
}
```

**Response `201`** with the new message, or **`200`** with the original message when `client_id` was already used (a retry). Like every single resource it is wrapped: `{ "data": Message }`. `409` if the `client_id` belongs to a message in another chat.

```json
{
  "data": {
    "id": "0195e2c4-000a-7a09-8109-5f3a9c011667",
    "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
    "sender": {
      "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
      "name": "Saw Eh Doh",
      "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
      "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
    },
    "sender_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "type": "text",
    "content": "Yes, I will bring the documents.",
    "reply_to_id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
    "reply_to": {
      "id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
      "sender_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
      "type": "text",
      "content": "Hello Eh Doh, are you coming on Saturday?",
      "is_deleted": false
    },
    "client_id": "0195e2c4-0009-7a08-8108-5f3a9c00f778",
    "is_edited": false,
    "edited_at": null,
    "metadata": {},
    "encrypted": false,
    "attachment": null,
    "created_at": "2026-03-14T09:02:41.733103Z"
  }
}
```

Everyone else hears [`message.sent`](#messagesent). For an attachment, upload the file first and send its id:

```json
{
  "client_id": "0195e2c4-000e-7a0d-810d-5f3a9c019223",
  "type": "image",
  "content": "The agenda",
  "metadata": {
    "attachment_id": "0195e2c4-000d-7a0c-810c-5f3a9c017334"
  }
}
```

A voice message, with the length and waveform the recording app measured. They are display hints: stored and returned exactly as sent, and never used by the server for anything else. Other message types accept only `attachment_id` in `metadata`; so does a voice message in an encrypted chat (put them inside the encrypted message there).

```json
{
  "client_id": "0195e2c4-0020-7a1f-811f-5f3a9c03d001",
  "type": "voice",
  "metadata": {
    "attachment_id": "0195e2c4-0021-7a20-8120-5f3a9c03d002",
    "duration_ms": 4200,
    "waveform": [12, 40, 88, 120, 96, 64, 140, 210, 255, 180, 150, 90, 60, 110, 170, 130, 80, 40, 30, 70, 120, 160, 140, 100, 60, 90, 130, 200, 230, 190, 120, 80, 50, 40, 60, 100, 140, 120, 90, 60, 40, 30, 20, 30, 50, 30, 20, 10]
  }
}
```

**Errors:** `422` (for example a missing `content` on a text message, a `duration_ms` sent as a string, or a `waveform` with 15 values); `403` if you are not a member; `429` over 30 a minute. In an encrypted chat also `409 envelope_mismatch` and `409 no_recipient_devices`, and `422` if `content` is present.

### GET /messages/{message}

One message. Use it when a real-time [`message.sent`](#messagesent) arrives for an **encrypted** chat: that event carries no ciphertext, so fetch the message (with `X-Device-Id`) to get your envelope. **Who:** members of the chat; anyone else gets `404`.

**Response `200`:** `{ "data": Message }`.

### PATCH /messages/{message}

Edit a message's text. **Who:** its sender, within 24 hours of sending. Encrypted messages cannot be edited (`403`): delete and send again.

| Field | Type | Rules |
|---|---|---|
| `content` | string | max 5000. Required on a text message; a media message may drop its caption (`null`). |

**Response `200`:** `{ "data": Message }` with `is_edited: true`. Members hear [`message.updated`](#messageupdated).

### DELETE /messages/{message}

Delete a message. **Who:** its sender, or a group owner/admin. The message disappears from the API at once and its attachment and encrypted copies are removed permanently after 30 days (encrypted copies are deleted immediately). **Response `204`.** Members hear [`message.deleted`](#messagedeleted).

### 3.6 Attachments

### POST /chats/{chat}/attachments

Upload a file for a later message. `multipart/form-data`:

| Field | Type | Rules |
|---|---|---|
| `file` | file | required, max 25 MB |
| `encrypted_key` | string | **Encrypted chats only**, optional, max 4096 characters. Opaque data (for example a wrapped file key) stored and returned untouched. Not allowed in plaintext chats. |

The server never uses the client's file name on disk and decides the stored type from the file's content. Images get a thumbnail a few moments later. An upload that is not attached to a message within 24 hours is deleted.

**Voice recordings.** Content detection cannot tell an audio-only WebM or MP4 from a video: a voice note recorded in Chrome or Firefox (WebM/Opus) is detected as `video/webm`, and one recorded in Safari (MP4/AAC with the common `isom` brand) as `video/mp4`. When the detected type is `video/webm`, `video/mp4` or `video/ogg` **and** the type your request declares for the file (its `Content-Type` in the form data) starts with `audio/`, it is stored as `audio/webm`, `audio/mp4` or `audio/ogg`. The container always stays the one the content proves; nothing else is taken from the declared type. So upload a recording as, for example, `voice-1773478800.webm` with type `audio/webm` (without the `;codecs=` part), and it can be sent as a `voice` message.

**Response `201`:**

```json
{
  "data": {
    "id": "0195e2c4-000d-7a0c-810c-5f3a9c017334",
    "original_name": "agenda.png",
    "mime_type": "image/png",
    "size": 1497,
    "url": "https://api.example.org/api/v1/attachments/0195e2c4-000d-7a0c-810c-5f3a9c017334/file?expires=1773478800&signature=3f9a1c7e5b2d8046a1e7c93b5d0f284a6e1b97c3d50a8f42e6b1c9d7a3e05f81",
    "thumbnail_url": null,
    "created_at": "2026-03-14T09:00:00.000000Z"
  }
}
```

Send the `id` as `metadata.attachment_id` in a message.

### GET /attachments/{attachment}/file

### GET /attachments/{attachment}/thumbnail

Download the bytes. **No bearer token:** access is granted by the signed URL (`url` / `thumbnail_url` of an [Attachment](#attachment)), valid for 60 minutes; without a valid signature the answer is `403`. Images and audio are shown inline, everything else is a download. Byte ranges are answered (`Range: bytes=0-99` gives `206 Partial Content` with `Content-Range`; a range past the end gives `416`), which Safari needs to play audio and video at all, and which lets every browser seek. These responses are private-cacheable for an hour and always carry `Content-Security-Policy: default-src 'none'; sandbox` and `X-Content-Type-Options: nosniff`. `404` for a missing thumbnail.

### 3.7 Video rooms

Video runs on a self-hosted LiveKit server. The API decides **who may join** and hands out a signed token; the app connects to LiveKit with `livekit-client` using that token. See [section 7](#7-guide-video-rooms) for the whole flow.

Who can see (and ask to join) a room: its host, anyone who has already asked to join, and members of the chat it is linked to. A room **not** linked to a chat can be opened by anyone who has its id (share the link); its password and waiting room still apply. Everyone else gets `403`.

### POST /rooms

Create a room. You become its host.

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, max 120 |
| `description` | string | optional, max 1000 |
| `type` | string | optional: `instant` or `scheduled`. Normally leave it out: a room with `scheduled_at` is `scheduled`, otherwise `instant`. `scheduled_at` is not allowed with `type: "instant"` and required with `type: "scheduled"`. |
| `scheduled_at` | date | optional, must be in the future. With it the room is `scheduled`, without it `instant`. |
| `duration_minutes` | integer | optional, 5–1440. Informational: a room does not end by itself when this passes. |
| `chat_id` | uuid | optional. Invites every member of that chat and posts a `system` message in it ("X started a video room: …"), which also sends push notifications. You must be a member of that chat (otherwise `403`, the same answer for chats that do not exist). |
| `password` | string | optional, 4–64 characters. Stored hashed. |
| `waiting_room_enabled` | boolean | optional, default `false` |
| `max_participants` | integer | optional, 2–100, default 50 |

```json
{
  "name": "Committee meeting",
  "description": "Monthly planning call",
  "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
  "password": "open-sesame",
  "waiting_room_enabled": true,
  "max_participants": 20,
  "scheduled_at": "2026-03-14T09:09:12+00:00",
  "duration_minutes": 60
}
```

**Response `201`:** `{ "data": Room }`.

```json
{
  "id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
  "type": "scheduled",
  "name": "Committee meeting",
  "description": "Monthly planning call",
  "host": {
    "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "name": "Saw Eh Doh",
    "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
    "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
  },
  "host_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
  "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
  "has_password": true,
  "waiting_room_enabled": true,
  "is_locked": false,
  "max_participants": 20,
  "scheduled_at": "2026-03-14T09:09:35.618225Z",
  "duration_minutes": 60,
  "status": "waiting",
  "started_at": null,
  "ended_at": null,
  "recording_enabled": false,
  "created_at": "2026-03-14T09:09:58.722954Z",
  "present_count": 0,
  "my_participation": {
    "role": "host",
    "admission": "admitted"
  },
  "waiting_participants": []
}
```

The LiveKit room itself is created when the first person joins.

### GET /rooms

Rooms that have not ended and that you host, were invited to through a chat, or asked to join. Newest first, cursor-paginated.

`?filter=` is optional: `hosting` (you host), `invited` (someone else hosts) or `upcoming` (scheduled rooms still to come, soonest first).

**Response `200`:** a list of [Room](#room) (without `waiting_participants`).

### GET /rooms/{room}

One room. The host and co-hosts also get `waiting_participants`.

**Response `200`:** `{ "data": Room }`.

### POST /rooms/{room}/join

Ask to join. **Limit:** 20 per minute per person and room (it guards the password).

| Field | Type | Rules |
|---|---|---|
| `password` | string | Required **only** when the room has a password and you have not already been let in. The host, and people already admitted or waiting, are not asked again. |

There are two successful outcomes:

- **Admitted** (`200`). Connect to LiveKit with `livekit_url` and `token`. The token lasts one hour (`LIVEKIT_TOKEN_TTL`). Its identity is your user id and its metadata is `{ "role", "avatar_url" }`; the host and co-hosts get LiveKit admin rights. A seat is reserved for you for 120 seconds while you connect, so two people asking for the last seat cannot both get in. Reconnecting always works for someone who already holds a seat.

```json
{
  "status": "admitted",
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJ2aWRlbyI6eyJyb29tSm9pbiI6dHJ1ZX19.c2lnbmF0dXJl",
  "livekit_url": "wss://livekit.example.org",
  "room": {
    "id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
    "type": "scheduled",
    "name": "Committee meeting",
    "description": "Monthly planning call",
    "host": {
      "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
      "name": "Saw Eh Doh",
      "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
      "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
    },
    "host_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
    "has_password": true,
    "waiting_room_enabled": true,
    "is_locked": false,
    "max_participants": 20,
    "scheduled_at": "2026-03-14T09:09:35.618225Z",
    "duration_minutes": 60,
    "status": "waiting",
    "started_at": null,
    "ended_at": null,
    "recording_enabled": false,
    "created_at": "2026-03-14T09:09:58.722954Z",
    "present_count": 0,
    "my_participation": {
      "role": "host",
      "admission": "admitted"
    },
    "waiting_participants": []
  }
}
```

- **Waiting** (`200`). The room has a waiting room, so the host has to let you in. There is no token yet. You hear [`room.admitted`](#roomadmitted) or [`room.denied`](#roomdenied) on your `private-user` channel; after `room.admitted`, call join again (no password needed).

```json
{
  "status": "waiting"
}
```

**Errors**

| Status | `code` | Meaning |
|---|---|---|
| `422` | | `errors.password`: missing or wrong password |
| `403` | `join_denied` or none | You are not invited to this room, or the host refused or removed you |
| `409` | `room_ended` | The room is over |
| `409` | `room_locked` | The host is not letting new people in (people already admitted can still reconnect) |
| `409` | `room_full` | All seats are taken |
| `503` | | The video service is unreachable; try again |
| `429` | | More than 20 attempts a minute |

```json
{
  "message": "The room password is incorrect.",
  "errors": {
    "password": [
      "The room password is incorrect."
    ]
  }
}
```

```json
{
  "message": "This room is locked. The host is not letting new people in.",
  "code": "room_locked"
}
```

### 3.8 Room controls

Calls below are for the room's host and co-hosts (marked per route). Everyone else gets `403`.

### POST /rooms/{room}/admit/{user}

Let a waiting (or previously denied) person in. **Who:** host or co-host. Admitting someone already admitted changes nothing. The person hears [`room.admitted`](#roomadmitted) and then calls join.

**Response `200`:** a [Room participant](#room-participant).

```json
{
  "user": {
    "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "name": "Naw Paw Say",
    "avatar_url": null,
    "avatar_thumb_url": null
  },
  "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
  "role": "participant",
  "admission": "admitted",
  "joined_at": null,
  "left_at": null
}
```

### POST /rooms/{room}/deny/{user}

Turn a waiting person away. **Who:** host or co-host. Only people who are *waiting* can be denied (`409 not_waiting`); to put out someone who is already in the call use `remove`. The person hears [`room.denied`](#roomdenied).

**Response `200`:** a [Room participant](#room-participant) with `admission: "denied"`.

### POST /rooms/{room}/participants/{user}/remove

Put someone out of the call and stop them coming back. **Who:** host or co-host (a co-host cannot remove the host or another co-host; nobody removes themselves). The person is marked `denied`, disconnected from LiveKit, and if they reconnect with a token they still hold they are put out again at once. The host can let them back with `admit`.

**Response `204`.** `503` if LiveKit is unreachable (the person is still blocked from rejoining; try again to disconnect them).

### POST /rooms/{room}/participants/{user}/mute

Mute someone's microphone or camera. **Who:** host or co-host (same limits as `remove`). LiveKit allows the server to mute but not unmute: people unmute themselves.

| Field | Type | Rules |
|---|---|---|
| `kind` | string | optional: `audio` (default) or `video` |

**Response `200`:** `{ "data": { "muted_tracks": 1 } }` (`0` if they were already muted). `409 participant_not_connected` if the person is not in the call.

### POST /rooms/{room}/co-hosts/{user}

Make an admitted participant a co-host. **Who:** the host only. Their LiveKit admin rights apply from their next join; the API treats them as a co-host at once. Everyone in the room hears [`room.role_changed`](#roomrole_changed).

**Response `200`:** a [Room participant](#room-participant) with `role: "co_host"`. `404` if the person is not admitted to the room.

### POST /rooms/{room}/lock

### POST /rooms/{room}/unlock

Stop (or resume) letting new people in. **Who:** the host only. People already admitted can still reconnect. **Response `200`:** `{ "data": Room }`. `409 room_ended` if the room is over.

### POST /rooms/{room}/end

End the meeting for everyone: LiveKit disconnects all participants and the room becomes `ended`. **Who:** the host only. Ending an ended room does nothing. If LiveKit cannot be reached the room stays open (`503`) so the host can try again.

**Response `200`:** `{ "data": Room }` with `status: "ended"`. Everyone hears [`room.ended`](#roomended).

### GET /rooms/{room}/audit-log

What the host and co-hosts did in this room, newest first. **Who:** the host only. Cursor-paginated.

| `action` | Done by | `target` | `metadata` |
|---|---|---|---|
| `room.created` | the host | | `type`, `chat_id`, `waiting_room`, `password_protected`, `max_participants` |
| `room.participant_admitted` | host / co-host | the person | |
| `room.participant_denied` | host / co-host | the person | |
| `room.participant_removed` | host / co-host | the person | |
| `room.participant_muted` | host / co-host | the person | `kind`, `muted_tracks` |
| `room.co_host_appointed` | the host | the person | |
| `room.locked`, `room.unlocked` | the host | | |
| `room.ended` | the host | | |
| `room.host_transferred` | the system (`actor: null`) | the new host | `previous_host_id` |
| `room.auto_ended` | the system (`actor: null`) | | `reason`: `never_started`, `empty` or `too_long` |

An entry is written only when something changed (admitting someone already admitted is not logged) and never records IP addresses or devices. People joining and leaving are not logged here; `joined_at` / `left_at` on the participants cover that.

```json
{
  "data": [
    {
      "id": "0195e2c4-001c-7a1b-811b-5f3a9c034335",
      "action": "room.participant_removed",
      "actor": {
        "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
        "name": "Saw Eh Doh",
        "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
        "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
      },
      "target": {
        "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
        "name": "Naw Paw Say",
        "avatar_url": null,
        "avatar_thumb_url": null
      },
      "metadata": {},
      "created_at": "2026-03-14T09:10:21.827683Z"
    },
    {
      "id": "0195e2c4-001d-7a1c-811c-5f3a9c036224",
      "action": "room.participant_denied",
      "actor": {
        "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
        "name": "Saw Eh Doh",
        "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
        "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
      },
      "target": {
        "id": "0195e2c4-0010-7a0f-810f-5f3a9c01d001",
        "name": "Naw Mu Moo",
        "avatar_url": null,
        "avatar_thumb_url": null
      },
      "metadata": {},
      "created_at": "2026-03-14T09:10:44.932412Z"
    }
  ],
  "links": {
    "first": null,
    "last": null,
    "prev": null,
    "next": null
  },
  "meta": {
    "path": "https://api.example.org/api/v1/rooms/0195e2c4-001a-7a19-8119-5f3a9c030557/audit-log",
    "per_page": 30,
    "next_cursor": null,
    "prev_cursor": null
  }
}
```

### 3.9 Encryption: devices and keys

How these fit together is explained in [section 5](#5-guide-end-to-end-encryption). The server stores **public** keys only.

### POST /devices

Register this installation as an encryption device. **Limit:** 20 per hour; at most 10 active devices per user. All keys are **standard padded base64**.

| Field | Type | Rules |
|---|---|---|
| `name` | string | required, max 100 ("Pixel 7") |
| `identity_public_key` | string | 32 bytes, Ed25519. Unique across all devices. |
| `exchange_public_key` | string | 32 bytes, X25519 |
| `signed_prekey.id` | integer | 0 – 2 147 483 647 |
| `signed_prekey.public_key` | string | 32 bytes, X25519 |
| `signed_prekey.signature` | string | 64 bytes: Ed25519 signature, by the identity key, over the **raw 32 bytes** of the signed prekey's public key. The server verifies it. |
| `one_time_prekeys` | array | 20–100 items `{ id, public_key }`; ids and keys unique within the request |

Extra fields (a private key by mistake, for example) are rejected.

```json
{
  "identity_public_key": "2dC1AxOZriYejXJpv4fMNjnpvFrfh5ELwymUCZSTNck=",
  "exchange_public_key": "5bCi+WAfYmZ4hKbti67C8AOdX/weLOT7eBAN3/GCm0Y=",
  "signed_prekey": {
    "id": 1,
    "public_key": "LT78lV3PTPtUctWE0oxS3ERZtz35Z9H9m+t5bwBxK0k=",
    "signature": "i0fjqbl9Tw7NA2ItQMSirgNSUkf6SJKICh/MRdWsegrJ7melC8hUVu+3JFSuXyKDK3Tj3jx4s8W4yVvfP2psAQ=="
  },
  "one_time_prekeys": [
    {
      "id": 1,
      "public_key": "xcs//u+n78v4GlWAXcVDOWVEvolFJsPhRYBWk3mQ+Ec="
    },
    {
      "id": 2,
      "public_key": "O0THY0LBrJBBpBiFkmlAkjrRF/L6zEWwQHK16HMsPgY="
    },
    {
      "id": 3,
      "public_key": "T7dFx5EXm7gMeYIcJTeunclgBclswhA77bL/bBwWEAg="
    },
    {
      "id": 4,
      "public_key": "R3GAST1lV1o/xPi/asFEGnTjiQCfWJNdbalxAPBkGyU="
    },
    {
      "id": 5,
      "public_key": "N+noHeI0cR7equzp/JOKKiTVgh3Zb9M5uPTAuxakB1s="
    },
    {
      "id": 6,
      "public_key": "mfqmtKh8xwrOsfrUjyJ/BGEpL3aLOyagSyI9u6yaOVI="
    },
    {
      "id": 7,
      "public_key": "pKIcYDCT8sRunMOK0msU4/LB2F3f5NmsNfZ6kegdWmw="
    },
    {
      "id": 8,
      "public_key": "6wXms682fnN7zs6PzlwQpdl5Q7e4JhnXkC/FwCH5/U8="
    },
    {
      "id": 9,
      "public_key": "kmfNpxMpQsnHOtOSDrefK/NrzU+A715PENYq9qR/PGY="
    },
    {
      "id": 10,
      "public_key": "XppG/2sic7UKhg55y2Dx94vOokVMf7RXJue1UNw+vQk="
    },
    {
      "id": 11,
      "public_key": "IdehuyY3rJ2pnsslKkk7r5Y3WLI6I9SDDxHky6TS6A8="
    },
    {
      "id": 12,
      "public_key": "W5p4Lm/ycYjoTX+iSjBARecVZEpyMzloeQlyWNkJfV0="
    },
    {
      "id": 13,
      "public_key": "xE7Ig2nlk7lSHUJK8ATAPqMdaU9WX9IXEF391QAA3Ds="
    },
    {
      "id": 14,
      "public_key": "fPeSOBsZr63QmWE3LKgfJfYjgunXXfuYZVDfeIxar2I="
    },
    {
      "id": 15,
      "public_key": "jy2u5Jv/6FGSXkkC83LhqMRF8kT/ZMr+IIyZNavOAz4="
    },
    {
      "id": 16,
      "public_key": "O/WabVMavYQjFfzfTeySjbpgZQD+05oqHsCOHRS7jBw="
    },
    {
      "id": 17,
      "public_key": "SiEenzGZQmRljROPy82QmYXfbIyTznNNAsSuKaX8GGI="
    },
    {
      "id": 18,
      "public_key": "bfxXBz/EwkUfMxvCMflvRBQM/ksVnWae1OHv5oMkkCQ="
    },
    {
      "id": 19,
      "public_key": "6r7i+0fAtgHSRY2l9ivzIYgKftm6fAFpZ+LGxl4BAnE="
    },
    {
      "id": 20,
      "public_key": "GaNtezU4iGPmjBX/K/MmBa9OdAVQ9OpbJPGM68GxonI="
    }
  ],
  "name": "Pixel 7"
}
```

**Response `201`:** a [Device](#device) with `unclaimed_prekeys`. Your other devices and everyone who shares an encrypted chat with you hear [`device.added`](#deviceadded).

**Errors:** `422` for a wrong key length, a signature that does not verify (`errors.signed_prekey.signature`), a duplicate identity key, or too many prekeys; also `422` with `errors.device` when you already have 10 active devices; `429` over 20 registrations an hour.

```json
{
  "message": "The identity public key must be standard base64 of exactly 32 bytes. (and 6 more errors)",
  "errors": {
    "identity_public_key": [
      "The identity public key must be standard base64 of exactly 32 bytes."
    ],
    "exchange_public_key": [
      "The exchange public key field is required."
    ],
    "signed_prekey": [
      "The signed prekey field is required."
    ],
    "signed_prekey.id": [
      "The signed prekey.id field is required."
    ],
    "signed_prekey.public_key": [
      "The signed prekey.public key field is required."
    ],
    "signed_prekey.signature": [
      "The signed prekey.signature field is required."
    ],
    "one_time_prekeys": [
      "The one time prekeys field is required."
    ]
  }
}
```

### GET /devices

Your active devices, oldest first (each with `unclaimed_prekeys`). **Response `200`:** `{ "data": [Device] }`. Not paginated: there are at most 10.

### DELETE /devices/{device}

Revoke a device (for example a lost phone). It stops appearing in key bundles, can no longer send or read, its unclaimed prekeys are deleted, and senders get `409 envelope_mismatch` (`unexpected_device_ids`) until they stop encrypting for it. **Response `204`.** Other devices of yours and your encrypted-chat contacts hear [`device.revoked`](#devicerevoked).

Other people's devices, and revoked ones, answer `404` on all `/devices/{device}` routes.

### PUT /devices/{device}/signed-prekey

Rotate the signed prekey (do it every week or so). The new key must have a **new id**, and its signature is checked against the device's identity key.

| Field | Type | Rules |
|---|---|---|
| `id` | integer | required, different from the current id |
| `public_key` | string | 32 bytes, base64 |
| `signature` | string | 64 bytes, base64 |

**Response `200`:** `{ "data": Device }`.

### POST /devices/{device}/prekeys

Top up one-time prekeys. 1–100 at a time, and at most 200 unclaimed per device. Key ids are never reused, even after a prekey was handed out.

| Field | Type | Rules |
|---|---|---|
| `prekeys` | array | `[{ id, public_key }]`, ids unique and never used before for this device |

**Response `201`:** `{ "data": { "unclaimed": 23 } }`

### GET /devices/{device}/prekeys/count

How many unclaimed prekeys are left. Poll this now and then and top up when it drops below about 10. **Response `200`:** `{ "data": { "unclaimed": 23 } }`.

### GET /users/{user}/key-bundles

Get what you need to start an encrypted session with **each active device** of a user. For every device the server hands out **one** one-time prekey, atomically and exactly once, so two people asking at the same moment get different ones. **Limit:** 10 per minute per target user (to stop anyone draining someone's prekeys).

**Who:** yourself, or someone you share a chat with; anyone else gets `404`.

| Query / header | Meaning |
|---|---|
| `device_ids[]` | Optional: only these devices (for example the ones named in an `envelope_mismatch`). Prekeys are claimed only for them. |
| `X-Device-Id` | Optional. When you ask for **your own** bundles, the calling device is left out. |

```json
{
  "data": [
    {
      "device_id": "0195e2c4-0013-7a12-8112-5f3a9c022cce",
      "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
      "identity_public_key": "JdAFK9J0qkGrppR+fqku+yE5bnYIHdblzmYli8MczaQ=",
      "exchange_public_key": "g7fZQw2msS9EUjU1tVJ8IVSibOHNRAo7gp6C2Jm3JBg=",
      "signed_prekey": {
        "id": 1,
        "public_key": "v1dNy1rAKlQlNkGqySlRAf6oe0ypxI6c8H0MuAbG9As=",
        "signature": "+ZEH5/2sRCipTqeeSj2h9SETF6migQdM4lLt8MxdzImziKWCcGXHB8M5+bzDaGYgc9nUuaL+69TBpnJFL+r5Cw=="
      },
      "one_time_prekey": {
        "id": 1,
        "public_key": "ttBq4kc8b2/eZFSHP1Kplgi7EdmC08inu3Vo2QAi6wk="
      }
    }
  ]
}
```

`one_time_prekey` is `null` when that device has run out; start the session with the signed prekey alone. Bundles never contain a device name.

### 3.10 Push notifications

Explained in [section 6](#6-guide-push-notifications).

### GET /push/public-key

The key the browser needs to subscribe (`applicationServerKey`). `enabled: false` means the server has no push keys and push is off.

```json
{
  "data": {
    "enabled": true,
    "public_key": "fake-public-key"
  }
}
```

### POST /push/subscriptions

Register this browser for push notifications. The body is the browser's own `subscription.toJSON()`. **Limit:** 30 per hour; at most 20 subscriptions per user.

| Field | Type | Rules |
|---|---|---|
| `endpoint` | string | required, `https` URL of a supported push service (Chrome/Edge/Android `fcm.googleapis.com`, Firefox `*.push.services.mozilla.com`, Safari `*.push.apple.com`, Windows `*.notify.windows.com`); max 2048 characters. Other addresses are refused. |
| `keys.p256dh` | string | required, the browser's public key: **unpadded base64url**, 65 bytes |
| `keys.auth` | string | required, the browser's auth secret: unpadded base64url, 16 bytes |

Other members of the browser's object (such as `expirationTime`) are ignored.

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/dAbC12-example",
  "expirationTime": null,
  "keys": {
    "p256dh": "BAfdcVBP-fIMUGvJlOfSrSCDj-NTJ2XMt1kkyizswjqAxWAEf-crQpQhIYd4Ub4T3ieZHTKURw8mlOSuUOF9GLA",
    "auth": "1rY-tSBOKoGQ7yb_puqBpw"
  }
}
```

**Response `201`**, or **`200`** when this browser was already registered (its keys are refreshed; if it was registered by *another* user on the same browser it moves to you):

```json
{
  "data": {
    "id": "0195e2c4-0019-7a18-8118-5f3a9c02e668",
    "endpoint": "https://fcm.googleapis.com/fcm/send/dAbC12-example",
    "created_at": "2026-03-14T09:08:26.304038Z"
  }
}
```

The subscription is tied to the login you made it with: signing out, or the token expiring, ends it.

**Errors:** `422` for an unsupported endpoint, wrong key sizes, or more than 20 subscriptions.

```json
{
  "message": "The endpoint must be the https URL of a supported browser push service. (and 2 more errors)",
  "errors": {
    "endpoint": [
      "The endpoint must be the https URL of a supported browser push service."
    ],
    "keys.p256dh": [
      "The keys.p256dh must be unpadded base64url of exactly 65 bytes."
    ],
    "keys.auth": [
      "The keys.auth must be unpadded base64url of exactly 16 bytes."
    ]
  }
}
```

### GET /push/subscriptions

Your subscriptions (one per browser), oldest first. **Response `200`:** `{ "data": [PushSubscription] }`. The endpoint lets a browser recognise its own entry; the keys are never returned.

### DELETE /push/subscriptions/{subscription}

Stop notifications for one browser (call it when the user turns notifications off, after `subscription.unsubscribe()`). **Response `204`.** Someone else's subscription answers `404`.

### 3.11 Real-time channel authorization

### POST /broadcasting/auth

(`GET` works too.) Authorise a WebSocket channel subscription. Laravel Echo calls this for you when `authEndpoint` is set to `/api/v1/broadcasting/auth` and the bearer token is sent. See [section 4](#4-real-time-events).

| Field | Type | Rules |
|---|---|---|
| `socket_id` | string | required, from the WebSocket connection |
| `channel_name` | string | `private-user.{id}`, `private-chat.{id}`, `presence-chat.{id}` or `presence-room.{id}` |

```json
{
  "auth": "local-dev-key:5b1e9c0d7a43f268e1b05d9c37a4f82e6b0d1c9a58e37f4b2a60d9c1e8f35b74"
}
```

For `presence-*` channels the answer also carries `channel_data` (the member info other members will see: `id`, `name`, `avatar_url`).

```json
{
  "auth": "local-dev-key:5b1e9c0d7a43f268e1b05d9c37a4f82e6b0d1c9a58e37f4b2a60d9c1e8f35b74",
  "channel_data": "{\"user_id\":\"0195e2c4-0001-7a00-8100-5f3a9c000000\",\"user_info\":{\"id\":\"0195e2c4-0001-7a00-8100-5f3a9c000000\",\"name\":\"Saw Eh Doh\",\"avatar_url\":\"\\/storage\\/avatars\\/0195e2c4-0001-7a00-8100-5f3a9c000000\\/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp\"}}"
}
```

A channel you may not join answers `403`.

### 3.12 Webhooks

### POST /webhooks/livekit

Called **by the LiveKit server, not by the app.** It is how the API learns who is really connected: `joined_at`, `left_at`, room activity and host transfers come only from here. The request is signed by LiveKit (a JWT in the `Authorization` header that covers the body); a missing or wrong signature gets `401`. Handles `participant_joined`, `participant_left` and `room_finished`; other events are accepted and ignored. Safe against duplicate and out-of-order delivery.

A person who connects with a token the host has since revoked is disconnected again at once.

```json
{
  "message": "ok"
}
```

`401` for a bad signature:

```json
{
  "message": "Invalid webhook signature."
}
```

## 4. Real-time events

WebSockets run on Laravel Reverb, which speaks the Pusher protocol, so the frontend uses `laravel-echo` with `pusher-js`. Events are produced by a queue worker, so they arrive a fraction of a second after the REST call that caused them.

### 4.1 Connecting

```js
import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

const echo = new Echo({
  broadcaster: 'reverb',
  key: import.meta.env.VITE_REVERB_APP_KEY,
  wsHost: import.meta.env.VITE_REVERB_HOST,
  wsPort: import.meta.env.VITE_REVERB_PORT,
  wssPort: import.meta.env.VITE_REVERB_PORT,
  forceTLS: import.meta.env.VITE_REVERB_SCHEME === 'https',
  enabledTransports: ['ws', 'wss'],
  authEndpoint: `${API_BASE}/api/v1/broadcasting/auth`,
  auth: { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
});
```

The app key is public (it identifies the Reverb application); the secret never leaves the server. After a token is replaced (login), update `auth.headers` and reconnect.

### 4.2 Channels

Echo strips the `private-` / `presence-` prefix: `Echo.private('chat.X')` is the channel `private-chat.X`, `Echo.join('chat.X')` is `presence-chat.X`.

| Channel | Who may join | Used for |
|---|---|---|
| `private-user.{userId}` | that user only | An always-on channel: subscribe once at login. New messages and new chats in chats you have **not** opened, being added to or removed from a chat, read state from your other devices, device changes, and the room invitations meant for you. |
| `private-chat.{chatId}` | members of the chat | Everything that happens in a chat you have open. |
| `presence-chat.{chatId}` | members of the chat | Who is in the chat right now, and typing indicators. Member info is `{ id, name, avatar_url }`. |
| `presence-room.{roomId}` | the host and **admitted** participants | Who is in a video room and room-wide events. People still waiting to be let in are not on it; what concerns them arrives on their `private-user` channel. |

`private-chat.X` and `presence-chat.X` are different channels. A client with a chat open joins **both**, and `private-user.{me}` once.

A channel you may not join fails authorization with `403`; channel names with a malformed id are refused the same way.

**Typing indicators** are client whispers on the presence channel; there is no server endpoint:

```js
echo.join(`chat.${id}`).listenForWhisper('typing', (e) => { /* e.user_id, e.typing */ });
echo.join(`chat.${id}`).whisper('typing', { user_id: me.id, typing: true });   // throttle to about one per 2 seconds
```

### 4.3 Events

Custom event names need a leading dot in Echo: `.listen('.message.sent', handler)`. Payloads below are real recordings. **None contains anyone's email address or phone number.**

Rules that apply to every event:

- You can receive an event twice (for example `message.sent` arrives on both `private-chat.X` and `private-user.{me}`): de-duplicate by `id`.
- Events can arrive out of order or be missed while offline. Treat them as hints, and repair state from the REST API after reconnecting.
- The connection that caused a change is not sent its own event if it passed `X-Socket-ID`; your other devices still receive it.
- Payloads are built when the change happens, so they show the state at that moment.

### `message.sent`

A message was sent. Same shape as a [Message](#message) from the REST API, except `client_id` is never included. Every member also receives it on their `private-user` channel, so chats you have not opened can show a new message and badge.

Channels: `private-chat.0195e2c4-0004-7a03-8103-5f3a9c005ccd`, `private-user.0195e2c4-0001-7a00-8100-5f3a9c000000`, `private-user.0195e2c4-0003-7a02-8102-5f3a9c003dde`

```json
{
  "message": {
    "id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
    "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
    "sender": {
      "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
      "name": "Naw Paw Say",
      "avatar_url": null,
      "avatar_thumb_url": null
    },
    "sender_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "type": "text",
    "content": "Hello Eh Doh, are you coming on Saturday?",
    "reply_to_id": null,
    "reply_to": null,
    "is_edited": false,
    "edited_at": null,
    "metadata": {},
    "encrypted": false,
    "attachment": null,
    "created_at": "2026-03-14T09:02:18.628374Z"
  }
}
```

In an **encrypted** chat `content` is `null`, `encrypted` is `true` and there is **no `envelope` and no ciphertext** in the event. Fetch `GET /messages/{id}` with your `X-Device-Id` to get your envelope.

### `message.updated`

A message was edited. Channel `private-chat.{id}` only, so a chat-list preview may be stale until the list is fetched again. Payload `{ message }`, as for `message.sent`.

### `message.deleted`

Channels: `private-chat.0195e2c4-0004-7a03-8103-5f3a9c005ccd`

```json
{
  "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
  "message_id": "0195e2c4-000f-7a0e-810e-5f3a9c01b112"
}
```

### `message.read`

Someone moved their read position. Goes to the chat channel and to the reader's own `private-user` channel (so their other devices clear the unread badge).

Channels: `private-chat.0195e2c4-0004-7a03-8103-5f3a9c005ccd`, `private-user.0195e2c4-0003-7a02-8102-5f3a9c003dde`

```json
{
  "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
  "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
  "last_read_message_id": "0195e2c4-000a-7a09-8109-5f3a9c011667",
  "last_read_at": "2026-03-14T09:02:41.733103Z"
}
```

### `chat.updated`

A group was renamed or its description changed. Also sent to every member's `private-user` channel. The payload is a chat summary: nothing specific to one viewer (no unread count).

Channels: `private-chat.0195e2c4-0006-7a05-8105-5f3a9c009aab`, `private-user.0195e2c4-0001-7a00-8100-5f3a9c000000`, `private-user.0195e2c4-0003-7a02-8102-5f3a9c003dde`, `private-user.0195e2c4-0005-7a04-8104-5f3a9c007bbc`

```json
{
  "chat": {
    "id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
    "type": "group",
    "name": "Community committee 2026",
    "description": "Planning, announcements and minutes",
    "avatar_url": null,
    "is_encrypted": false,
    "member_count": 3,
    "last_message_at": "2026-03-14T09:03:04.837832Z"
  }
}
```

### `chat.member_added`

Someone joined a chat. Existing members hear it on the chat channel. The new member hears it on their `private-user` channel: **if `user.id` is you, you were added to a chat** (or someone started a direct chat with you): fetch it with `GET /chats/{id}` and subscribe to it.

Channels: `private-user.0195e2c4-0003-7a02-8102-5f3a9c003dde`

```json
{
  "chat": {
    "id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
    "type": "direct",
    "name": null,
    "description": null,
    "avatar_url": null,
    "is_encrypted": false,
    "member_count": 2,
    "last_message_at": "2026-03-14T09:00:46.209458Z"
  },
  "user": {
    "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "name": "Naw Paw Say",
    "avatar_url": null,
    "avatar_thumb_url": null
  }
}
```

### `chat.member_removed`

Someone left or was removed. Sent to the chat channel and to the removed person's `private-user` channel. If `user_id` is you, unsubscribe from the chat and drop it from the list.

Channels: `private-chat.0195e2c4-0006-7a05-8105-5f3a9c009aab`, `private-user.0195e2c4-0010-7a0f-810f-5f3a9c01d001`

```json
{
  "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
  "user_id": "0195e2c4-0010-7a0f-810f-5f3a9c01d001"
}
```

### `device.added`

A person you encrypt for (or one of your own accounts) registered a new encryption device. Goes to the owner's `private-user` channel and to everyone who shares an **encrypted** chat with them. Payload: ids only. Fetch `GET /users/{user_id}/key-bundles?device_ids[]={device_id}` and include an envelope for the device in the next message you send.

Channels: `private-user.0195e2c4-0001-7a00-8100-5f3a9c000000`

```json
{
  "user_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
  "device_id": "0195e2c4-0012-7a11-8111-5f3a9c020ddf"
}
```

### `device.revoked`

The device was revoked: forget its session and stop encrypting for it. Same audience and payload as `device.added`.

Channels: `private-user.0195e2c4-0001-7a00-8100-5f3a9c000000`, `private-user.0195e2c4-0003-7a02-8102-5f3a9c003dde`

```json
{
  "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
  "device_id": "0195e2c4-0013-7a12-8112-5f3a9c022cce"
}
```

### `room.participant_joined`

Someone connected to the video room (reported by LiveKit). Channel `presence-room.{id}`.

Channels: `presence-room.0195e2c4-001a-7a19-8119-5f3a9c030557`

```json
{
  "room_id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
  "user": {
    "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "name": "Naw Paw Say",
    "avatar_url": null,
    "avatar_thumb_url": null
  },
  "role": "participant"
}
```

### `room.participant_left`

Someone disconnected.

Channels: `presence-room.0195e2c4-001a-7a19-8119-5f3a9c030557`

```json
{
  "room_id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
  "user": {
    "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "name": "Naw Paw Say",
    "avatar_url": null,
    "avatar_thumb_url": null
  },
  "role": "co_host"
}
```

### `room.join_requested`

Someone is waiting to be let in. Sent to the room channel and to the `private-user` channel of the host and every co-host, so they can be told even when the room window is not open.

Channels: `presence-room.0195e2c4-001a-7a19-8119-5f3a9c030557`, `private-user.0195e2c4-0001-7a00-8100-5f3a9c000000`

```json
{
  "room_id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
  "user": {
    "id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
    "name": "Naw Paw Say",
    "avatar_url": null,
    "avatar_thumb_url": null
  }
}
```

### `room.admitted`

The host let you in. Sent only to the waiting person's `private-user` channel. **Call `POST /rooms/{id}/join` again** to get your token (no password needed this time).

Channels: `private-user.0195e2c4-0003-7a02-8102-5f3a9c003dde`

```json
{
  "room": {
    "id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
    "name": "Committee meeting",
    "type": "scheduled",
    "status": "waiting",
    "host_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
    "is_locked": false
  }
}
```

### `room.denied`

The host turned you away, or removed you from the call. Only to that person's `private-user` channel. Same payload as `room.admitted`.

Channels: `private-user.0195e2c4-0010-7a0f-810f-5f3a9c01d001`

```json
{
  "room": {
    "id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
    "name": "Committee meeting",
    "type": "scheduled",
    "status": "active",
    "host_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "chat_id": "0195e2c4-0006-7a05-8105-5f3a9c009aab",
    "is_locked": false
  }
}
```

### `room.role_changed`

A co-host was appointed, or the host role moved on. `role` is the new role of `user_id`; `host_id` is the current host.

Channels: `presence-room.0195e2c4-001a-7a19-8119-5f3a9c030557`

```json
{
  "room_id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
  "user_id": "0195e2c4-0003-7a02-8102-5f3a9c003dde",
  "role": "co_host",
  "host_id": "0195e2c4-0001-7a00-8100-5f3a9c000000"
}
```

### `room.ended`

The room is over; leave the call. Channel `presence-room.{id}`.

Channels: `presence-room.0195e2c4-001a-7a19-8119-5f3a9c030557`

```json
{
  "room_id": "0195e2c4-001a-7a19-8119-5f3a9c030557",
  "ended_at": "2026-03-14T09:13:25.665515Z"
}
```

## 5. Guide: end-to-end encryption

In an encrypted chat the server is only a **key directory** and a **ciphertext relay**. All encryption and decryption happens in the clients. The server stores public keys and opaque encrypted blobs, and it never receives a private key or any plaintext. (A test scans the source to make sure no code decrypts or reads ciphertext.)

**What the server can still see** (metadata, not content): who is in which chat, who sent a message and from which device, when, how large the envelopes are, a message's type (text / image / voice / file) and attachment ids, and reply links. Say so honestly in the app's privacy text.

> **For the frontend.** Use a vetted protocol, not home-made cryptography. As a minimum, libsodium `crypto_box` / sealed boxes; ideally a Double Ratchet library (Signal-style). Ed25519 *signing* keys and X25519 *exchange* keys are two separate key pairs: never derive one from the other ad hoc.

### 5.1 Keys

| Key | Size | Notes |
|---|---|---|
| `identity_public_key` | 32 bytes | Ed25519 (signing). Unique across all devices. |
| `exchange_public_key` | 32 bytes | X25519 |
| `signed_prekey.public_key` | 32 bytes | X25519, with an integer `id`. Rotate regularly with `PUT /devices/{device}/signed-prekey`. |
| `signed_prekey.signature` | 64 bytes | Ed25519 signature by the identity key over the raw 32 bytes of the signed prekey's public key. The server verifies it. |
| one-time prekeys | 32 bytes each | X25519, each with an integer `id`. Each is handed out **at most once**. |

Private keys are generated on the device and stay there. A user can have up to 10 active devices, because every message needs one envelope per recipient device.

### 5.2 Sending

1. Register the device once (`POST /devices`) and keep every private key on the device.
2. Create or open the encrypted chat (`is_encrypted: true`; it is fixed for the life of the chat. Two people can have a plaintext and an encrypted direct chat side by side).
3. For each member with devices you have no session with yet, `GET /users/{user}/key-bundles`. Include your **own** other devices (`GET /users/{me}/key-bundles` leaves out the device named in `X-Device-Id`).
4. Encrypt the message once **per recipient device**.
5. `POST /chats/{chat}/messages` with `X-Device-Id: <your device>`:

```json
{
  "client_id": "0195e2c4-0015-7a14-8114-5f3a9c026aac",
  "type": "text",
  "envelopes": [
    {
      "recipient_device_id": "0195e2c4-0013-7a12-8112-5f3a9c022cce",
      "ciphertext": "wiFo6uqnVdpkItnpDyTQNU9km7DjENmWfsB3YRqzstCx2+6VoIpvg1U5ltahuF0BWd6CKdwa5vORW7BF",
      "header": {
        "alg": "x25519-xsalsa20-poly1305",
        "nonce": "XyJGsaspXKnH/bFmIhMcubf9KW8+QJaC",
        "ephemeral_key": "+ljEhheqtnEWEakZKru3GOVwT/7RRj68QGLY98yMQ0E=",
        "prekey_id": 7
      }
    }
  ]
}
```

Rules:

- `content` must be absent or `null`. Plaintext is rejected with `422`. The text (and an image caption) goes inside the ciphertext.
- There must be an envelope for **every active device of every member, including your own other devices**, except the sending device (it may include one for itself, but need not).
- `ciphertext` and `header` are opaque and stored exactly as sent. Limits: ciphertext 32 768 characters (text, no NUL bytes; send base64), `header` a non-empty object up to 4096 bytes, at most 1000 envelopes. Nothing in `envelopes` is trimmed or normalised.
- Replies and media work as in plaintext chats (`client_id`, `reply_to_id`, `metadata.attachment_id`, 30 messages per minute).

If the envelopes do not match you get **`409`** and nothing is stored:

```json
{
  "message": "The envelopes do not match the current devices of the chat members. Fetch key bundles for the missing devices and send again.",
  "code": "envelope_mismatch",
  "missing_device_ids": [
    "0195e2c4-0013-7a12-8112-5f3a9c022cce"
  ],
  "unexpected_device_ids": []
}
```

Fetch `key-bundles?device_ids[]=…` for the missing devices, add their envelopes, drop the unexpected ones (revoked, or no longer in the chat) and send again **with the same `client_id`**. `409 no_recipient_devices` means nobody else in the chat has registered a device yet.

### 5.3 Reading

`GET /chats/{chat}/messages` and `GET /messages/{id}` in an encrypted chat need `X-Device-Id`. Each message has `content: null`, `encrypted: true`, `metadata.sender_device_id` and `envelope`: **only your device's own** copy, never another device's. `envelope` is `null` if your device cannot read that message: it sent it itself, or it was added after the message was sent (new devices cannot read old history).

Real-time `message.sent` events for encrypted messages carry **no envelope**: fetch the message with `GET /messages/{id}` and your `X-Device-Id`.

```json
[
  {
    "id": "0195e2c4-0016-7a15-8115-5f3a9c02899b",
    "chat_id": "0195e2c4-0014-7a13-8113-5f3a9c024bbd",
    "sender": {
      "id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
      "name": "Saw Eh Doh",
      "avatar_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef.jpg",
      "avatar_thumb_url": "https://api.example.org/storage/avatars/0195e2c4-0001-7a00-8100-5f3a9c000000/0195e2c4-0002-7a01-8101-5f3a9c001eef_256.webp"
    },
    "sender_id": "0195e2c4-0001-7a00-8100-5f3a9c000000",
    "type": "text",
    "content": null,
    "reply_to_id": null,
    "reply_to": null,
    "is_edited": false,
    "edited_at": null,
    "metadata": {
      "sender_device_id": "0195e2c4-0012-7a11-8111-5f3a9c020ddf"
    },
    "encrypted": true,
    "envelope": {
      "recipient_device_id": "0195e2c4-0013-7a12-8112-5f3a9c022cce",
      "ciphertext": "wiFo6uqnVdpkItnpDyTQNU9km7DjENmWfsB3YRqzstCx2+6VoIpvg1U5ltahuF0BWd6CKdwa5vORW7BF",
      "header": {
        "alg": "x25519-xsalsa20-poly1305",
        "nonce": "XyJGsaspXKnH/bFmIhMcubf9KW8+QJaC",
        "ephemeral_key": "+ljEhheqtnEWEakZKru3GOVwT/7RRj68QGLY98yMQ0E=",
        "prekey_id": 7
      }
    },
    "attachment": null,
    "created_at": "2026-03-14T09:08:03.199309Z"
  }
]
```

### 5.4 Devices come and go

[`device.added`](#deviceadded) and [`device.revoked`](#devicerevoked) tell you when to fetch a bundle or forget a session. Poll `GET /devices/{device}/prekeys/count` and top up below about 10.

### 5.5 What does not work in encrypted chats

- **Editing** is refused (the server cannot re-encrypt for every device). Delete and send a new message. Deleting removes the envelopes at once.
- **Attachments** are opaque encrypted blobs: no thumbnail, no type check, the file name is not stored (keep the real name and type inside the message), downloads are always forced.
- The server cannot make **search, previews or push text** from content. Push notifications for these chats only say "New message".
- Members added later cannot read earlier messages.

---

## 6. Guide: push notifications

Push notifications reach a phone whose app is closed, through the browser's own push service (Google, Mozilla, Apple). The server encrypts every notification to the browser's keys, so the push service cannot read it.

### 6.1 Subscribing

1. `GET /push/public-key`. If `enabled` is `false`, push is off on this server: hide the option.
2. Register a service worker and ask permission (`Notification.requestPermission()`).
3. Subscribe, passing the key as `applicationServerKey`:

```js
const registration = await navigator.serviceWorker.ready;
const subscription = await registration.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(publicKey),   // the public_key from step 1
});
```

4. `POST /push/subscriptions` with `subscription.toJSON()`. Keep the returned `id`.
5. To stop, call `subscription.unsubscribe()` and `DELETE /push/subscriptions/{id}`.

Subscriptions end by themselves when the user signs out, shortly after the login expires (30 days; expired logins are cleaned up daily), and when the browser's push service says the subscription is gone. After logging in again, subscribe again (the existing subscription is simply refreshed). On iPhones, web push only works for an app added to the Home Screen.

### 6.2 What a notification contains

The service worker receives JSON (`event.data.json()`):

```json
{
  "type": "message.new",
  "chat_id": "0195e2c4-0004-7a03-8103-5f3a9c005ccd",
  "message_id": "0195e2c4-0008-7a07-8107-5f3a9c00d889",
  "sent_at": "2026-03-14T09:02:18.628374Z",
  "encrypted": false,
  "title": "Naw Paw Say",
  "body": "Hello Eh Doh, are you coming on Saturday?",
  "message_type": "text"
}
```

| Field | Notes |
|---|---|
| `title`, `body` | Ready to show. Direct chat: the sender and the first 100 characters. Group: the group name, and "Sender: …". Media: "Sent a photo" / "Sent a voice message" / "Sent a file". English text; use `message_type` (and the names) to localise. |
| `encrypted` | `true` for encrypted chats. Then `title` is just the app name, `body` is exactly **"New message"**, and there is no sender, chat name or content. |
| `chat_id`, `message_id` | Open the right conversation when the notification is tapped |
| `room_id` | Present when the message announces a video room |
| `message_type` | `text`, `image`, `file`, `voice` or `system` (plaintext chats only) |

If the server is set to hide previews (`PUSH_SHOW_PREVIEW=false`), `body` is "New message" for every chat.

```js
self.addEventListener('push', (event) => {
  const data = event.data.json();
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.chat_id,          // newer messages from one chat replace older notifications
    data,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { chat_id, room_id } = event.notification.data;
  event.waitUntil(clients.openWindow(room_id ? `/rooms/${room_id}` : `/chats/${chat_id}`));
});
```

### 6.3 Who is notified

A new message notifies every other member of the chat who has at least one subscription, **except** people who muted the chat (`is_muted`, until `muted_until` if set), and people whose app is open (their heartbeat is alive: they already get the message over the WebSocket). Edits, deletions and read receipts never send a push. A notification not delivered within a day is dropped by the push service (the app shows the message when it is opened).

---

## 7. Guide: video rooms

1. **Create:** `POST /rooms` (link it to a chat with `chat_id` and the chat's members are invited, and told by a system message and a push notification).
2. **Join:** `POST /rooms/{id}/join`.
   - `status: "admitted"` → connect with `livekit-client`:

```js
import { Room } from 'livekit-client';

const room = new Room({ adaptiveStream: true, dynacast: true });
await room.connect(livekit_url, token);                 // both from the join response
await room.localParticipant.setMicrophoneEnabled(true);
await room.localParticipant.setCameraEnabled(true);
```

   - `status: "waiting"` → show "waiting for the host". Listen for `room.admitted` / `room.denied` on `private-user.{me}`; after `room.admitted` call join again.
3. **In the call:** subscribe to `presence-room.{id}` for [`room.participant_joined`](#roomparticipant_joined), [`room.participant_left`](#roomparticipant_left), [`room.role_changed`](#roomrole_changed) and [`room.ended`](#roomended). Hosts and co-hosts listen to [`room.join_requested`](#roomjoin_requested) and use `admit` / `deny` / `remove` / `mute`. Camera, microphone and speaking state come from the LiveKit SDK, never from this API.
4. **Reconnecting:** LiveKit reconnects by itself for short drops. If the token has expired (one hour) or the page was reloaded, call join again: it always works for someone who already holds a seat.
5. **Ending:** the host calls `end`; everyone receives `room.ended`. If everybody leaves, LiveKit closes the room after 5 minutes and the server ends it.
6. **If the host's connection drops**, the host role moves to the earliest-joined connected co-host, otherwise the earliest-joined connected participant (after a configurable grace period); everyone gets `room.role_changed`.

Calls over restrictive mobile networks need the server's TURN setup (see the README); nothing changes in the client.

---

## 8. Limits and enums

### 8.1 Limits

| What | Limit |
|---|---|
| Message text | 5000 characters |
| Attachment upload | 25 MB |
| Avatar | 2 MB, JPEG/PNG/WebP, 6000×6000 px |
| Group members | 256 |
| Members added per request | 50 |
| Page size | 30 default, 100 maximum |
| Presence lookup | 100 ids per request |
| Message edit window | 24 hours |
| Signed attachment URL | 60 minutes |
| Presence (heartbeat) lifetime | 90 seconds |
| Login token | 30 days |
| LiveKit token | 1 hour |
| Room size | 2–100 participants (default 50) |
| Encryption devices per user | 10 active |
| Registering a device | 20–100 one-time prekeys |
| Unclaimed prekeys per device | 200 |
| Envelopes per message | 1000; ciphertext 32 768 characters; header 4096 bytes |
| Push subscriptions per user | 20 |
| Deleted messages are purged | 30 days after deletion |
| Unsent uploads are purged | 24 hours after upload |

### 8.2 Enums

| Name | Values |
|---|---|
| Chat `type` | `direct`, `group` |
| Chat member `role` | `owner`, `admin`, `member` |
| Message `type` | `text`, `image`, `file`, `voice`, `system` |
| User `status` | `online`, `away`, `busy`, `offline` |
| Room `type` | `instant`, `scheduled` |
| Room `status` | `waiting`, `active`, `ended` |
| Room participant `role` | `host`, `co_host`, `participant` |
| Room participant `admission` | `waiting`, `admitted`, `denied` |
| Audit `action` | `room.created`, `room.participant_admitted`, `room.participant_denied`, `room.participant_removed`, `room.participant_muted`, `room.co_host_appointed`, `room.locked`, `room.unlocked`, `room.ended`, `room.host_transferred`, `room.auto_ended` |
