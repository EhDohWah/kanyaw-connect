# Frontend progress

Phase by phase, as agreed. A phase is done when every item is ticked, `npm run build`, `npm run type-check`
and `npm run test` pass, and this file is up to date. Deviations from the build prompt are written next to the
item they belong to.

| Phase | Status |
|---|---|
| 1. Foundation | Done, waiting for review |
| 2. Messaging | Not started |
| 3. Feed and sidebar | Not started |
| 4. Video | Not started |
| 5. Push and polish | Not started |

## Phase 1: Foundation

- [x] **Project setup.** Vue 3 (`<script setup lang="ts">`), Vite, strict TypeScript, Tailwind CSS v4, Pinia, Vue Router
  (history mode), axios, `lucide-vue-next`, `vue-i18n`, Vitest and Vue Test Utils, all at their latest versions.
  - *Deviation:* TypeScript is pinned to **6.0.3**, not the newest 7.x. `vue-tsc` (3.3.13, the latest) cannot run on
    TypeScript 7 yet (`ERR_PACKAGE_PATH_NOT_EXPORTED: ./lib/tsc`). Move to 7 when `vue-tsc` supports it.
  - *Deviation:* `laravel-echo`, `pusher-js` and `livekit-client` are not installed yet. They are first used in Phases 2
    and 4, and their documentation is read when they are added.
  - The frontend lives in `frontend/` inside the backend repository (one repo, one branch), not in a separate repository.
- [x] **Design tokens.** The whole palette is defined once in `src/style.css` (`@theme`). The default Tailwind palette is
  switched off (`--color-*: initial`), so a colour that is not a token cannot be used. Verified in the built CSS: every
  token utility exists, no default-palette colour (purple and so on) is present.
  - *Additions to the table in the prompt:* `on-primary` (white text on primary), `danger-soft` (error message
    background), `success` (the "saved" tick), `on-call` (text on the dark call screen) and eight avatar colours for
    initials avatars. All are calm hues with white text readable on them; none is purple.
- [x] **Fonts.** System font stack for Latin text; Noto Sans Myanmar from Google Fonts (`font-display: swap`, loaded
  without blocking the first paint) for `my` and `ksw`, with a 1.8 line height. Checked in a real browser: for those
  languages the page gets `lang="my"`, the font list starts with Noto Sans Myanmar, and the line height is 1.8.
- [x] **i18n.** `en.json` in full (all text goes through `vue-i18n`); `my.json` and `ksw.json` have the same keys,
  untranslated (they show English through the fallback). `npm run i18n:sync` adds new keys to both, and a test fails when
  the three files differ. The language is remembered in `localStorage`, taken from the browser the first time, and saved on
  the account (`PATCH /me { locale }`) when it is changed while signed in.
- [x] **axios client** (`src/api/http.ts`) with interceptors:
  - Token: `Authorization: Bearer …` and `Accept: application/json` on every request (not on login and register).
  - `X-Socket-ID`: wired up (`setSocketIdResolver`) and sent on requests that change something. The resolver is set in
    Phase 2, when Echo exists.
    *Deviation:* it is not sent on `GET` requests. The prompt says every request; `docs/API.md` (the contract) says
    "on requests that change something", and a read causes no event to suppress.
  - `401`: only when the token that was refused is still the one we hold (a late answer for an old token must not sign out
    a new session): the session is cleared and the person is sent to `/login`, remembering the page and saying why.
  - `429`: a `GET`/`HEAD` waits for `Retry-After` and is repeated once, when the wait is 10 seconds or less.
    *Deviation:* the prompt says to wait and retry. A `POST` is **not** repeated on its own (sending twice might do the
    thing twice), and a wait longer than 10 seconds is shown to the person instead of being waited out silently
    ("Too many requests. Please wait 40 seconds…"). Requests that are safe to repeat opt in with `retryOn429`
    (message sending is, because of `client_id`).
  - Every failure is thrown as one `ApiError` (status, code, field errors, retry-after, `isNetwork`).
- [x] **Auth store.** Login, register (then login, because the API's register does not sign in), logout (the device is
  signed out even when the server cannot be reached), profile update, avatar upload, language change. The token and its
  expiry are in `localStorage` (`kc.token`, `kc.tokenExpiresAt`), never logged and never put in a URL. A token past its
  expiry is dropped at start without asking the server. If the server cannot be reached at start, the token is kept and the
  shell offers "Try again" instead of signing the person out.
- [x] **Login and register pages.** Quick checks in the browser, the server's field errors shown under the right
  field, wrong credentials shown once for the whole form, a clear message for "too many attempts" and "cannot reach the
  server", password show/hide, correct `autocomplete` values for password managers. After registering the person is signed
  in automatically; if that second step fails they are sent to login with an explanation.
  - Only paths inside the app are accepted for "go back to where I was" (`?redirect=`): no other site, no `//host`.
  - No "Forgot password" link (the backend has no such endpoint; see the backend gaps in the prompt).
- [x] **Route guards.** Every route except `/login` and `/register` needs a signed-in user; signed-in users are sent
  away from those two. All routes from the prompt exist, including `/chats/:id` and `/rooms/:id`. Chats, meetings and the
  feed are placeholders ("Your chats will appear here.") until their phases.
- [x] **Responsive shell.** At 1024 px and wider three columns (navigation and Create button, content, "People &
  activity" placeholder); from 768 to 1023 px an icon rail; below 768 px a bottom bar with Home, Messages, Create,
  Meetings, Profile, hidden inside a conversation or a call. Measured in a real browser at 1280, 900, 390 and 320 px.
  - *Deviation:* **Settings** is in the left navigation on tablet and desktop (the prompt lists Home, Messages, Meetings,
    Profile there). Without it, Settings (with Sign out) would have no way in on larger screens. On phones the bottom bar
    keeps the five slots from the prompt, and Settings is one tap away from Profile (a gear in its header).
  - The Create button opens a dialog whose two options say "Coming soon" until Phases 3 and 4.
  - Also in the shell: skip link, page title that follows page and language, focus moved to the content after navigating,
    offline banner (browser offline now; the WebSocket part comes with Phase 2).
- [x] **Profile page.** Avatar upload with preview and progress (JPEG, PNG or WebP, field `avatar`), name, phone, time zone
  and language. Only the fields that changed are sent; an emptied phone sends `null`.
  - *Addition:* a photo over 2 MB (every phone photo) is shrunk in the browser to a 1600 px WebP before upload, instead of
    being refused. In the browser run a 14 MB photo was sent as 1 MB. GIF and SVG are refused before anything is sent.
- [x] **Heartbeat.** `POST /me/heartbeat` once on start, then every 45 seconds, only while the page is visible. A hidden tab
  is quiet; coming back sends one at once (never faster than the 12 per minute the server allows). A failure waits
  longer each time (doubling, up to 5 minutes), a `429` waits at least `Retry-After`, a `401` stops it for good.
- [x] **Tests.** See "Verification" below.

### Verification (Phase 1)

- `npm run build`, `npm run type-check` and `npm run test` pass: 186 tests in 21 files. The backend's own suite (1058 tests) and Pint still pass.
- Tests run the real API client, router, stores and components with only the network replaced, so a test exercises the
  same code path as the app. Mutation checks (deliberately breaking six behaviours one at a time) made the tests fail as
  they should; two guards that are duplicated on purpose (the redirect check, the hidden-tab check) are tested through their
  behaviour.
- A real Chromium run against the running backend (reseeded with the demo accounts) passed 67 checks: sign in and out,
  redirect after login, 30-day token, heartbeat on start and 45.0 s later, no heartbeat for 50 s while hidden, a revoked
  token sending the person to login with the reason, register (including a taken email), profile save and reload,
  time zone, photo upload (small PNG and a 14 MB JPEG), language switch, focus trap and Escape in the Create dialog,
  44 px touch targets in the bottom bar, no sideways scrolling at 320 px, visible focus ring, no console errors or Vue
  warnings, and an **axe-core** scan (WCAG 2.0/2.1 A and AA plus best practices) with no violations on login, register,
  the shell, profile, settings and the open dialog.
- Not verified here: Noto Sans Myanmar actually rendering (Google Fonts cannot be reached from the sandbox, and the
  Myanmar texts are English placeholders anyway), Safari and Firefox (only Chromium was available).

### Backend gaps and notes found in this phase

- `docs/API.md` shows `POST /auth/login` returning only `token` and `expires_at` (the prompt already knows about this);
  the real response includes `user`.
- The backend has no translation files and does not switch language by the account's `locale`, so the `message` and
  field errors it sends (for example "The email has already been taken.") are always English. Our own messages are
  translated; the server's are shown as they are. Worth a decision before the Karen translations arrive.
- Nothing blocked the phase.

## Phase 2: Messaging

Not started.

## Phase 3: Feed and sidebar

Not started.

## Phase 4: Video

Not started.

## Phase 5: Push and polish

Not started.
