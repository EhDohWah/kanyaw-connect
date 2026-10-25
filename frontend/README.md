# Kanyaw Connect: web frontend

The web app for Kanyaw Connect: private chat, community feed and video meetings for the Karen community. It is a
single-page app (Vue 3) that talks to the Laravel API in the parent folder. Build progress is tracked in
[`PROGRESS.md`](PROGRESS.md); the API it follows is [`../docs/API.md`](../docs/API.md).

> **Status:** the five phases of the original build are done: sign in and register, the responsive shell, profile with
> photo, presence, private chats in real time (direct and group, replies, pictures and files, edit and delete, typing,
> unread counts, chat drawer), a feed of sample posts, the Create dialog, the "People & activity" sidebar, video
> meetings, push notifications that open the right chat or meeting, and the Settings page. Phase 6 is under way: voice
> messages (6A) are built; one-to-one calls (6B, 6C) come next (see [`PROGRESS.md`](PROGRESS.md)).

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
                the camera and microphone preview, recording a voice message)
  push/         notifications: browser.ts (the one place that talks to the service worker, the push subscription and
                the notification permission) and links.ts (a tapped notification opens its chat or meeting)
  i18n/         en.json (complete), my.json and ksw.json (same keys, to be translated)
  realtime/     the WebSocket: Echo, the channel manager (what is joined, and when) and what each event does; LiveKit:
                callSession.ts (the one place that talks to livekit-client) and localMedia.ts (camera and microphone)
  mocks/        the sample feed (people, posts, comments, and the service that serves them from the browser), and the
                development-only call layout preview
  router/       routes, sign-in guards, and pageLoad.ts (a page whose code cannot be downloaded after an app update)
  services/     what the feed needs from a server (an interface); which implementation is used is set by VITE_FEED_SOURCE
  stores/       Pinia: auth, ui, chats, messages, presence, typing, drafts, realtime, feed, rooms, call, push, voicePlayback
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

**Passwords and email** (the server sends the emails; their links open pages of this app, so the server's `FRONTEND_URL`
must be this app's address):

- **Forgot your password?** on the sign-in page (it carries the address typed so far) opens `/forgot-password`. The
  page says the same whether or not the address has an account. The email links to `/reset-password?token=…&email=…`:
  the token is taken out of the address bar at once, so it does not stay in the history or reach other sites. A reset
  signs out every device, this one too, and "Sign in" fills in the address.
- **Settings → Password**: change it with the current one; your other devices are signed out, this one stays.
- **Verify your email**: the link from the email opens `/verify-email`, which works signed in or not, on any device.
  Until the address is verified a reminder sits at the top of the app (not inside a conversation or a call), with
  **Send again**; it can be hidden for the session, and Settings → Account keeps the button. Nothing in the app waits
  for verification. The reminder notices a verification made on another device when you come back to the tab.
- Developing locally, the server writes the emails into its `storage/logs/laravel.log` (`MAIL_MAILER=log`): copy the
  link from there.

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

## Voice messages

With the message box empty, the send button is a microphone. Tap it to record, then **Stop and listen** to hear the
recording before sending, **Send**, or the bin to delete it. Recording is tap-based (not hold-to-record), so it works
with one thumb, a keyboard and a screen reader.

- **Cheap on mobile data:** mono at 32 kbps (about 4 KB a second), and a voice message is not downloaded until someone
  presses play; the bubble shows its length and waveform before that (sent with the message, as display hints).
- **Formats:** the first the browser's recorder supports of MP4/AAC, MP4, WebM/Opus and Ogg/Opus. Chrome and Android
  record MP4 with Opus inside (Chrome cannot record AAC); Safari records MP4/AAC. The server stores audio-only WebM and
  MP4 as audio when the upload says it is audio (content detection alone calls them video). A file a device cannot play
  shows a short message and a download link.
- **Limits:** at least 1 second, at most 5 minutes (recording stops there and keeps what it has).
- **Privacy:** the microphone is turned off the moment recording stops or is deleted, and when you leave the chat, so
  the browser's recording sign never stays on.
- **Interruptions:** if the microphone stops (the permission is taken back, the browser stops it in a hidden tab), what
  was recorded is kept for listening.
- **Playing:** one voice message at a time across the app; the waveform is a slider (drag, or arrow keys for 5 seconds);
  1×, 1.5× and 2× speed. Recordings are served with byte ranges, which Safari needs and every browser uses to seek.
- Where the browser has no MediaRecorder or no microphone, there is no microphone button; an audio file can still be sent
  with the attach button.

## Calls

A direct chat's header has **Voice call** and **Video call** buttons (not in groups, and not in end-to-end encrypted
chats). A call is drawn above every page (`DirectCallOverlay` in `App.vue`), so moving around the app never hangs up:
the call shrinks to a bar at the top, "Return to call". The rules of a call (ringing, answered, ended, and why) are pure
functions in `src/utils/callOutcome.ts`; `src/stores/directCall.ts` talks to the API, LiveKit, the ringer and the other
tabs. The video library is still loaded only when a call connects.

- **Ringing:** an incoming call is a full screen with Accept, Decline and (for a video call) "Answer without video". The
  ringtone and ringback are made in the browser with the Web Audio API (no sound files); phones also vibrate. Browsers
  play no sound until the page has been tapped once, so a call before that rings silently and says "Tap to hear ringing".
  **Settings → Calls** turns the ringtone and the vibration off (`settings.call_ringtone`, `settings.call_vibrate`).
- **Several tabs:** only one tab rings, the visible one used most recently (the tabs agree over a `BroadcastChannel`);
  the others show a small banner. Answering or declining in one closes them all. During a meeting a call is a quiet banner
  with "Leave meeting and answer". An incoming call stops a voice recording and keeps what was recorded.
- **In a call:** video fills a phone held upright and is shown whole on its side; your own picture is a small mirrored
  window you can drag to any corner or tap to swap with theirs. A voice call shows their picture with a ring that follows
  their voice, and the connection quality in words. Microphone, camera, flip camera (with more than one camera), a speaker choice (where
  the browser allows it, mostly desktop Chrome and Edge), and End. The screen stays on during a call (Screen Wake Lock).
- **Dropped connections and reloads:** the app asks the server for the current call when it starts and after every
  reconnect, so a reload rejoins the call, and a call that ended meanwhile closes. A dropped call rejoins up to three times.
- **When the app is closed:** the call arrives as a notification with Answer and Decline (Decline works without opening
  the app); "Missed call" replaces it if nobody answers. With a window of the app visible, that window rings instead.
- **In the chat:** every call leaves a line written from your side ("Missed voice call", "Video call · 3:12") with Call
  back; the chat list shows the same text.
- There is no list of past calls (the chat lines are the history), no switching between voice and video during a call,
  and no calls in end-to-end encrypted chats.

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
| Chats and messages | Connected (Phase 2; voice messages Phase 6A). Not built: "seen by", encrypted chats (read-only notice) |
| Meetings and video | Connected (Phase 4). The in-call chat goes over LiveKit (the API has no endpoint for it) and is not saved: it is gone when the meeting ends, and the chat says so. No recording. One-to-one calls with ringing are built (Phase 6C; see Calls above) |
| Push notifications | Connected (Phase 5). The text is the server's, in English |
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
