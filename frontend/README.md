# Kanyaw Connect: web frontend

The web app for Kanyaw Connect: private chat, community feed and video meetings for the Karen community. It is a
single-page app (Vue 3) that talks to the Laravel API in the parent folder. Build progress is tracked in
[`PROGRESS.md`](PROGRESS.md); the API it follows is [`../docs/API.md`](../docs/API.md).

> **Status:** all five phases of the build are done: sign in and register, the responsive shell, profile with photo,
> presence, private chats in real time (direct and group, replies, pictures and files, edit and delete, typing, unread
> counts, chat drawer), a feed of sample posts (likes, comments, share, new posts), the Create dialog, the "People &
> activity" sidebar, video meetings (the Meetings page, pre-join, the call with screen sharing, chat and host controls),
> push notifications that open the right chat or meeting, and the Settings page. A sixth phase is planned: recording voice
> messages, and one-to-one calls (see [`PROGRESS.md`](PROGRESS.md)).

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

To try notifications on your computer, the backend needs its push keys once (in the repository root; see
[Notifications](#notifications)):

```bash
docker compose exec app php artisan push:vapid   # prints three lines: put them in the backend's .env
docker compose up -d                              # restart so the API and the queue worker read them
```

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

The LiveKit address is not configured here: the API sends it when a meeting is joined. The push key is not configured
here either: the app asks the API for it (`GET /push/public-key`).

## How it is organised

```
src/
  api/          one typed module per resource; http.ts is the only place that uses axios
  components/   layout/ (shell, navigation, chat drawer, Create dialog, the "People & activity" sidebar), chat/ (list,
                conversation, composer, dialogs), feed/ (post card, comments, picture drop zone, post form), rooms/ (meeting
                rows and lists, the New meeting form), call/ (pre-join, the call screen: video grid, tiles, toolbar,
                participants and chat panel, end screens), common/ (buttons, inputs, select, switch, dialog, avatar, states)
  composables/  logic shared between components (heartbeat, messaging session, open conversation, people, infinite scroll,
                the camera and microphone preview)
  push/         notifications: browser.ts (the one place that talks to the service worker, the push subscription and
                the notification permission) and links.ts (a tapped notification opens its chat or meeting)
  i18n/         en.json (complete), my.json and ksw.json (same keys, to be translated)
  realtime/     the WebSocket: Echo, the channel manager (what is joined, and when) and what each event does; LiveKit:
                callSession.ts (the one place that talks to livekit-client) and localMedia.ts (camera and microphone)
  mocks/        the sample feed (people, posts, comments, and the service that serves them from the browser), and the
                development-only call layout preview
  router/       routes, sign-in guards, and pageLoad.ts (a page whose code cannot be downloaded after an app update)
  services/     what the feed needs from a server (an interface); which implementation is used is set by VITE_FEED_SOURCE
  stores/       Pinia: auth, ui, chats, messages, presence, typing, drafts, realtime, feed, rooms, call, push
  types/        types that mirror the objects in docs/API.md
  utils/        small helpers: merging messages, dates and time zones, links in text, message rules, image shrinking,
                redirects, focus trap, the call grid, what a refused join means
  views/        one file per page
  style.css     the design tokens (the only place colours are defined)
public/
  sw.js         the service worker: shows notifications and opens the page of a tapped one (plain JavaScript, served as
                it is; type-checked by tsconfig.sw.json)
  manifest.webmanifest, icons/   for adding the app to a phone's Home Screen, and the notification icons
```

Tests sit in `__tests__/` folders next to the code they test. They run the real API client, router, stores and components
and replace only the network (`src/__tests__/helpers.ts`).

## Look and feel

Colours are tokens in `src/style.css` (`@theme`). The default Tailwind palette is switched off on purpose, so only these
can be used: `bg`, `surface`, `border`, `text`, `text-muted`, `primary`, `primary-hover`, `primary-soft`, `danger`,
`call-bg`, `call-surface`, plus a few helpers (`on-primary`, `danger-soft`, `success`, eight `avatar-*`, and for the dark
call screen `call-raised`, `on-call`, `on-call-muted`, `on-call-danger`).
To change the look of the whole app, change a value there.

One value differs from the build prompt: `text-muted` is `#6B6B73` instead of `#71717A`. The prompt's grey is 4.4:1 on
`surface` and 4.2:1 on `primary-soft` (hover and selected rows, other people's chat bubbles), under the 4.5:1 that WCAG AA
asks for small text; this one is 4.8:1 and 4.6:1, and looks the same.

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

## Video meetings

Meetings use the API for who may join, and a LiveKit server for the video; the API sends the LiveKit address and a
one-hour token when someone joins (`docker compose up` in the repository root starts LiveKit too). The video library is
large (about 140 KB compressed), so it is loaded only when a meeting is opened, in a file of its own.

- The browser lets a page use the camera and microphone only on `https://` or on `localhost`. To try a call from a phone
  on your network, serve the app over https and set the backend's `LIVEKIT_NODE_IP` (see the backend README).
- What is chosen on the pre-join screen goes into the call as it is: the camera opens once.
- A reload during a call joins again by itself (the tab keeps a note in `sessionStorage`); so does a call dropped for
  longer than LiveKit can bridge, or when its token runs out after an hour.
- Data saver stops receiving the others' cameras; screen shares still come through. Set in Settings, it is saved on the
  account (`settings.data_saver`) and every meeting starts with it; in a call, More options changes it for that meeting.
- Development only: `/rooms/<anything>?demo=6` shows the call screen with six sample people, to check the layout on one
  device. Production builds do not contain it.

## Notifications

When the app is closed, new messages and meeting invitations arrive as notifications (web push). Each person turns them
on in **Settings → Notifications**, once per browser.

- **How it works:** the app registers the service worker (`public/sw.js`), asks the browser's permission, subscribes with
  the server's public key and sends the subscription to the API. The server encrypts each notification for that browser
  and sends it through the browser's own push service (Google, Mozilla, Apple). The server does not notify people whose
  app is open: they see the message straight away.
- **What a tap opens:** the chat, or the meeting for an invitation, in the app's window if one is open (without
  reloading), otherwise in a new one. During a meeting a tap does not leave the call; the app says so instead.
- **One per chat:** a newer message from the same chat replaces the older notification.
- **Signing out** stops notifications on that browser (the server ends the subscription with the sign-in, and the app
  ends the browser's too, so the next person on a shared phone does not get them). Signing in again as the same person
  turns them back on without asking.
- **Blocked:** when someone said no to the browser's question, only the browser's own site settings can undo it; the
  Settings page says so, and notices when it has been allowed again.
- **iPhone and iPad:** web push works only for an app added to the Home Screen (Share → Add to Home Screen, then open it
  from there). The Settings page explains this on those devices. `public/manifest.webmanifest` makes the app installable.
- **Push switched off on the server** (no VAPID keys): the Notifications section is not shown at all.
- **Trying it locally:** browsers allow service workers only on `https://` or `http://localhost`, so use
  `http://localhost:5173` (not your computer's network address). The backend needs its keys: run `php artisan push:vapid`
  in the backend, put the three lines it prints in its `.env`, and restart the API and the queue worker. Chrome, Edge and
  Firefox on a computer show notifications; headless browsers (used for automated tests) cannot reach the push services.
- The notification text is written by the server in English (for example "Sent a photo"); my.json and ksw.json cannot
  change it.

## Accessibility

Checked against WCAG 2.1 AA with axe on every page and the main dialogs, on a phone, a tablet and a computer, and by hand:

- Everything works with a keyboard: "Skip to main content" first, a visible focus ring in `primary` on every stop,
  dialogs keep the focus inside, close on Escape and give it back; after moving to another page the focus is at the top
  of the content and the page title says where you are.
- Screen readers: every icon-only button has a name, switches and toggles say whether they are on, loading and errors are
  announced, every page has one main heading, and the page's language follows the chosen language (`lang="my"`).
- Touch targets are at least 44 × 44 px; nothing scrolls sideways down to 320 px wide (400 % zoom on a laptop); with
  "reduce motion" on, nothing slides or pulses.
- The call screen is dark, so its focus ring is light, and its errors use a lighter red (`on-call-danger`).

## Not connected to the backend yet

These parts of the product have no backend yet, or are not built yet:

| Feature | State |
|---|---|
| Feed, posts, likes, comments, shares | The backend has no endpoints. Built with sample data behind `src/services/feed.ts` (`VITE_FEED_SOURCE=mock`). The 30 sample posts are by invented people, with pictures from `picsum.photos`; what a person adds (posts, comments, likes) stays in their own browser (`localStorage`) and is not seen by anyone else. The feed says so in a note at the top |
| Writing a post | Mock: the picture is shrunk to a small copy and kept in the browser; nothing is sent anywhere |
| Sharing a post | The link (`/?post=<id>`) opens the feed: there is no page for one post |
| Chats and messages | Connected (Phase 2). Not built: recording voice messages (planned for Phase 6: an audio file sent with the attach button already becomes a voice message), "seen by", encrypted chats (read-only notice) |
| Meetings and video | Connected (Phase 4). The in-call chat goes over LiveKit (the API has no endpoint for it) and is not saved: it is gone when the meeting ends, and the chat says so. No recording. Not built: calling one person directly with ringing (planned for Phase 6; today, start a meeting and share it) |
| Push notifications | Connected (Phase 5). The text is the server's, in English |
| "Forgot password", changing the password, email verification | The backend has no endpoints |
| Finding people you share no chat with | The backend has no user search |
| Group photos, muting, archiving, pinning chats | The backend has no endpoints to change them. The app shows the state (pinned first, muted grey) but has no controls |
| Editing or cancelling a scheduled meeting | The backend can only end it |
| End-to-end encrypted chats | The backend is ready; the client-side cryptography is a separate project |

## Deploying

`npm run build` produces static files in `dist/`. Serve them from any static host, with a rule that answers every unknown
path with `index.html` (the app uses real URLs, not `#`). On the backend set `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` to
the app's address, and `REVERB_ALLOWED_ORIGINS` to its host name.

- Serve the app over **https** (notifications, the camera and the microphone need it).
- `sw.js` must stay at the root of the app (it looks after every page below it). The app asks the browser never to take
  it from its cache, so a new version is picked up on the next visit; it caches nothing itself.
- After a new version goes online, a tab that is still open may try to load a page file that no longer exists: it then
  loads that page afresh, once, which also brings the new version.
- Give the backend its push keys (`php artisan push:vapid`) and keep them: new keys end every browser's subscription.
