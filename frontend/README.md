# Kanyaw Connect: web frontend

The web app for Kanyaw Connect: private chat, community feed and video meetings for the Karen community. It is a
single-page app (Vue 3) that talks to the Laravel API in the parent folder. Build progress is tracked in
[`PROGRESS.md`](PROGRESS.md); the API it follows is [`../docs/API.md`](../docs/API.md).

> **Status:** Phase 3 of 5 (feed and sidebar) is built: sign in and register, the responsive shell, profile with photo,
> presence, private chats in real time (direct and group, replies, pictures and files, edit and delete, typing, unread
> counts, chat drawer), a feed of sample posts (likes, comments, share, new posts), the Create dialog (post, start a
> meeting) and the "People & activity" sidebar (who is online, upcoming meetings, people from your groups). Meeting rooms
> and video are placeholders until Phase 4.

## Run it

You need Node.js 22.18 or newer (or 24.12+) and the backend running.

```bash
# 1. The backend (in the repository root): API on http://localhost:8000, real-time on :8080
docker compose up

# 2. The frontend (in this folder)
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```

Sign in with a demo account: `user1@example.com` to `user5@example.com`, password `password`.

The backend must allow this origin. `CORS_ALLOWED_ORIGINS` (it defaults to `FRONTEND_URL`, which is
`http://localhost:5173` in the backend's `.env.example`) is already right for `npm run dev`; use the same port. The
dev server refuses to start on another port (`strictPort`) rather than silently picking one the backend does not allow.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run type-check` | TypeScript and Vue templates, no build |
| `npm run test` | All unit and component tests once (`npm run test:watch` keeps running) |
| `npm run i18n:sync` | Add keys that are new in `en.json` to `my.json` and `ksw.json` |
| `npm run preview` | Serve the built `dist/` locally |

## Settings (`.env`)

All are read at build time, and are public (they end up in the browser): never put a secret here.

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | The API, including `/api/v1`, no trailing slash |
| `VITE_REVERB_APP_KEY` | Reverb app key (public; it only identifies the application). Needed for real-time chat |
| `VITE_REVERB_HOST`, `VITE_REVERB_PORT`, `VITE_REVERB_SCHEME` | Where the WebSocket server is, `http` or `https` |
| `VITE_FEED_SOURCE` | `mock` (sample posts: the default) or `api` (for when the backend has a feed: today it answers that there is none) |

The LiveKit address is not configured here: the API sends it when a meeting is joined.

## How it is organised

```
src/
  api/          one typed module per resource; http.ts is the only place that uses axios
  components/   layout/ (shell, navigation, chat drawer, Create dialog, the "People & activity" sidebar), chat/ (list,
                conversation, composer, dialogs), feed/ (post card, comments, picture drop zone, post form), rooms/ (meeting
                row), common/ (buttons, inputs, dialog, avatar, states)
  composables/  logic shared between components (heartbeat, messaging session, open conversation, people, infinite scroll)
  i18n/         en.json (complete), my.json and ksw.json (same keys, to be translated)
  realtime/     the WebSocket: Echo, the channel manager (what is joined, and when) and what each event does
  mocks/        the sample feed: people, posts, comments, and the service that serves them from the browser
  router/       routes and sign-in guards
  services/     what the feed needs from a server (an interface); which implementation is used is set by VITE_FEED_SOURCE
  stores/       Pinia: auth, ui, chats, messages, presence, typing, drafts, realtime, feed, rooms
  types/        types that mirror the objects in docs/API.md
  utils/        small helpers: merging messages, dates, links in text, message rules, image shrinking, redirects, focus trap
  views/        one file per page
  style.css     the design tokens (the only place colours are defined)
```

Tests sit in `__tests__/` folders next to the code they test. They run the real API client, router, stores and components
and replace only the network (`src/__tests__/helpers.ts`).

## Look and feel

Colours are tokens in `src/style.css` (`@theme`). The default Tailwind palette is switched off on purpose, so only these
can be used: `bg`, `surface`, `border`, `text`, `text-muted`, `primary`, `primary-hover`, `primary-soft`, `danger`,
`call-bg`, `call-surface`, plus a few helpers (`on-primary`, `danger-soft`, `success`, `on-call`, eight `avatar-*`).
To change the look of the whole app, change a value there.

## Languages

English is complete. Burmese (`my`) and S'gaw Karen (`ksw`) have the same keys but are not translated yet: untranslated
text shows in English. To translate, edit `src/i18n/my.json` and `src/i18n/ksw.json`. After adding a text to `en.json`,
run `npm run i18n:sync`; a test fails if the three files do not have the same keys. In message texts avoid the
characters `{ } @ |` (they have a special meaning in `vue-i18n`).

Burmese and S'gaw Karen use Noto Sans Myanmar, loaded from Google Fonts (`index.html`). That request goes to Google, so
self-host the font if that matters to you. Under a strict Content-Security-Policy the font link's inline `onload`
handler would need a nonce or to move into `main.ts`.

## Sign-in and sessions

The API uses bearer tokens, not cookies. The token (valid 30 days, not extended by use) is kept in `localStorage`, sent in
the `Authorization` header, and never logged. When the server says the token is no longer valid the person is sent to the
login screen with the reason, and returns to the page they were on after signing in again. Signing out revokes this
device's token on the server.

## Not connected to the backend yet

These parts of the product have no backend yet, or are not built yet:

| Feature | State |
|---|---|
| Feed, posts, likes, comments, shares | The backend has no endpoints. Built with sample data behind `src/services/feed.ts` (`VITE_FEED_SOURCE=mock`). The 30 sample posts are by invented people, with pictures from `picsum.photos`; what a person adds (posts, comments, likes) stays in their own browser (`localStorage`) and is not seen by anyone else. The feed says so in a note at the top |
| Writing a post | Mock: the picture is shrunk to a small copy and kept in the browser; nothing is sent anywhere |
| Sharing a post | The link (`/?post=<id>`) opens the feed: there is no page for one post |
| Chats and messages | Connected (Phase 2). Not built: recording voice messages, "seen by", encrypted chats (read-only notice) |
| Meetings and video | Backend ready; screens arrive in Phase 4. "Start a meeting" and the "Upcoming meetings" list already use the real API, but `/rooms/:id` is a placeholder until then |
| Push notifications | Backend ready; arrive in Phase 5 |
| "Forgot password", changing the password, email verification | The backend has no endpoints |
| Finding people you share no chat with | The backend has no user search |
| Group photos, muting, archiving, pinning chats | The backend has no endpoints to change them. The app shows the state (pinned first, muted grey) but has no controls |
| Editing or cancelling a scheduled meeting | The backend can only end it |
| End-to-end encrypted chats | The backend is ready; the client-side cryptography is a separate project |

## Deploying

`npm run build` produces static files in `dist/`. Serve them from any static host, with a rule that answers every unknown
path with `index.html` (the app uses real URLs, not `#`). On the backend set `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` to
the app's address, and `REVERB_ALLOWED_ORIGINS` to its host name.
