# Frontend progress

Phase by phase, as agreed. A phase is done when every item is ticked, `npm run build`, `npm run type-check`
and `npm run test` pass, and this file is up to date. Deviations from the build prompt are written next to the
item they belong to.

| Phase | Status |
|---|---|
| 1. Foundation | Done, approved |
| 2. Messaging | Done, waiting for review |
| 3. Feed and sidebar | Done, waiting for review |
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

- [x] **Echo connection** (`src/realtime/`): one Echo instance created after login with the exact options from the prompt,
  disconnected on logout and whenever the token changes; `X-Socket-ID` wired into the API client.
  - `laravel-echo` 2.6.1 and `pusher-js` 8.6.0 (the installed versions' own documentation was read, not remembered).
    Pusher is handed to Echo as an option (`Pusher`), so nothing is put on `window`.
  - Echo 2.x registers its own axios interceptors for `X-Socket-ID`; they are switched off (`withoutInterceptors`) because
    our client already sends it. Same rule as in Phase 1: only on requests that change something, not on `GET`.
  - The connection state comes from Echo itself (`connectionStatus()` and `onConnectionChange`), not from hand-made
    listeners on the Pusher object.
- [x] **Channel management**: `private-user.{me}` once for the whole session; `private-chat.{id}` **and**
  `presence-chat.{id}` (typing) only while a chat is open; every event handled idempotently.
  - Opening the same chat in the drawer and on its page counts the watchers, so the channels are joined once and left
    when the last view closes.
  - Events never carry the `client_id`, so a message of your own that is still "sending" is matched to its confirmed copy
    by the answer to the `POST`; a copy that arrives first on the socket is found by `id` and shown once.
  - `message.updated` and `message.deleted` only exist on the chat channel (`docs/API.md`), so the preview of a chat that
    is not open can be stale until the list is fetched again. It is: on every reconnect and when the page comes back online.
- [x] **Resync after reconnect**: after every connection (first one, and each time it comes back) `GET /chats` and the
  first page of every open chat are fetched and merged by `id`; what was deleted meanwhile is dropped (within the range
  the page covers), and the list is replaced when the page does not overlap what we had (a gap too big to merge).
  - `GET /chats` is therefore fetched twice when the app starts: once when the shell appears (so the list does not wait
    for the socket) and once when the socket is connected. Cheap, and on purpose.
- [x] **Offline banner**: two states, "You are offline" (the browser has no network) and "Connection lost. Reconnecting…"
  (the WebSocket dropped after having worked). The banner is not shown during the first connection attempt.
- [x] **Chat list**: skeleton, empty and error states with "Try again"; avatar, title, preview ("You: …", Photo, Voice
  message, File, lock and "Encrypted message", system notices), time (clock today, "Yesterday", weekday within the week, short date after), unread
  badge (99+), online dot for direct chats (also spoken: ", Online" after the name), load more.
  - *Deviation:* more chats are loaded with a **"Show more chats"** button, not by scrolling. The list is short in practice,
    and a button is easier for keyboard and screen reader users.
  - *Addition:* the Messages item in the navigation (left rail, tablet rail and bottom bar) shows the total number of
    unread messages, not counting muted chats.
  - Pinned chats come first, then by last activity. Archived, pinned and muted state is shown (muted badge is grey); there are
    no controls to change it because the backend has no endpoints for it.
  - The preview of a system notice from the list cannot name the host ("Someone started a video room" would be wrong), so the
    server's own text is shown. The list does not carry the members; the conversation does ("Naw Paw started a video room").
- [x] **Chat drawer** (desktop, 1024 px and wider) with list and conversation inside it, collapsing to a small tab;
  **`/chats` and `/chats/:id`** as full pages (full-screen on phones, with a back button).
  - The drawer is a docked panel at the bottom right of the page. It is not drawn on `/chats`, `/chats/:id` or a room, where
    the messages are already on screen; opening a chat there never shows the same chat twice.
  - Open/closed state and the chat shown are remembered across reloads (`localStorage` key `kc.drawer`, damaged contents ignored).
  - If the open chat disappears (you were removed), the drawer returns to the list; on its page you are taken back to
    `/chats` with a note, unless you left yourself.
- [x] **Conversation**: grouped bubbles (same sender, same day, less than 5 minutes apart; the time under the last), day separators,
  reply previews (a deleted original says so), "edited" label, image thumbnails with a full-size viewer (download link,
  Escape, focus returned), file cards (name and size, signed link), audio player for voice messages, system notices
  (with "Join meeting"), linkified text, older messages on scroll to the top (with a "Load older messages" button as the
  keyboard route and as the retry).
  - Links are found in the text and rendered as elements (never as HTML), with `rel="noopener noreferrer nofollow"`.
  - Scrolling keeps what you were reading in place when older messages are added above it. When you are not at the end
    and new messages arrive, a "{n} new messages" button appears instead of moving the view.
  - A signed image or audio URL that has expired is refreshed once through `GET /messages/{id}`.
  - "Join meeting" opens `/rooms/{id}`, which is still a placeholder until Phase 4.
- [x] **Composer**: auto-growing textarea (Enter sends on desktop, send button on phones), attach button with upload
  progress, reply bar with cancel.
  - Enter sends only on a device with a mouse or similar, and never while an input method is composing a word (the
    Burmese and Karen keyboards use Enter to accept a candidate). On a touch screen Enter makes a new line.
  - Drafts (text, reply, edit) are kept per chat while the app is open. Pictures are previewed before sending; files over
    25 MB are refused before anything is uploaded. The box stops at the server's 5000 characters.
  - *Not included:* recording a voice message with the microphone (it is not in the Phase 2 list). An audio file picked
    with the attach button is sent as a voice message and plays in the player.
- [x] **Optimistic send and retry**: `sending` → `sent` → `failed` with "Tap to retry" that reuses the same `client_id`.
  - A network error or `5xx` is retried twice on its own (after 0.8 s and 2.5 s) with the same `client_id`, then shown as
    "Not sent" with **Tap to retry** and **Discard**. The picture or file is uploaded once; a retry does not upload it again.
  - *Deviation from the Phase 1 rule "a `POST` is not repeated on a `429`":* sending a message opts in (`retryOn429`),
    because the `client_id` makes it safe. The failure is still shown after one wait.
  - The server wraps the answer to `POST /chats/{chat}/messages` in `{ "data": … }`; `docs/API.md` showed it bare. The client
    accepts both, and the document has been corrected.
- [x] **Message actions**: Reply, Copy, Edit (own text, 24 hours), Delete (own; any for group owner/admin) with confirm;
  hover toolbar on desktop, long-press sheet on phones.
  - Keyboard: every message has a hidden "Message actions" button that appears on focus. Touch: press and hold 0.5 s (moving
    more than 10 px cancels it).
  - Only the text of a message can be edited (the server edits `content`); a picture's caption is not editable.
  - A refusal from the server is shown where the person is looking: in the confirm dialog for a delete (for example "You
    cannot delete this message."), above the box for an edit (which stays in edit mode, so nothing typed is lost).
- [x] **Read position** (`POST /chats/{chat}/read`) when the newest message is on screen; unread badges kept in step with
  other devices.
  - Reported (after 0.3 s) when the page is visible, the view is at the end, and someone else's messages follow the
    position the server has. A report that is waiting when you leave is sent at once, not lost.
  - Your other devices clear their badge through `message.read` on your user channel. Other people's read receipts are not
    shown ("seen by") because the prompt does not ask for them.
- [x] **Typing indicators** (whispers on the presence channel, at most one per 2 s, hidden 4 s after the last one).
  - The names come from the chat's members ("Naw Paw is typing…", "Naw Paw and Saw Eh Doh are typing…", and "Several people
    are typing…" for three or more).
    "Stopped typing" is sent at once, when the box is emptied or the message is sent.
- [x] **New direct chat and new group** from people already known from the user's chats.
  - The backend has no user search, so the people offered are those from your direct chats and from your groups (members of up
    to 20 groups are fetched, four at a time). The dialog says how to reach someone new.
  - Creating a direct chat that already exists opens it (`200`), a new one is `201`; both end in the conversation.
- [x] **Group info**: members and roles; owners/admins rename and add/remove members; the owner changes roles; everyone leaves.
  - Changes are live for everyone through `chat.updated`, `chat.member_added` and `chat.member_removed`.
  - Owner and last-owner rules follow `docs/API.md`; the buttons that the server would refuse are not offered.
- [x] **Encrypted chats**: read-only notice in place of messages and composer; lock icon and "Encrypted message" in the list.
  - The messages of an encrypted chat are not even requested (the client-side cryptography is a separate project).
- [x] **Tests**: merge and de-duplication, optimistic send and retry with the same `client_id`, pagination merge, resync after
  reconnect, API error handling (`401`, `409` codes, `429`), channel handling with a fake Echo. See "Verification" below.
- [x] **Verification** in a real browser against the running backend and Reverb, with two people chatting. See below.

### Verification (Phase 2)

- `npm run build`, `npm run type-check` and `npm run test` pass: **531 tests in 41 files** (Phase 1 had 186 in 21).
  The backend's own suite (1058 tests) still passes; the only backend-side change is the corrected example in `docs/API.md`.
- The tests use a fake Echo (`src/__tests__/fakeEcho.ts`) in place of the socket, and the same real API client, router,
  stores and components as the app, with only the network replaced. They cover the merge rules, the stores, the realtime
  manager (watch counting, whispers, reconnect), the API modules, every chat component, the drawer, and a check that every
  text key used in a template exists in `en.json` and that the three language files have the same keys.
- Mutation checks: 13 behaviours were broken on purpose, one at a time, and a test failed each time: a retry with a new
  `client_id`; no de-duplication by `id`; a late `message.sent` undoing an edit; counting a message twice (it arrives on two
  channels); counting your own message as unread; counting while the chat is on screen; losing the read report when leaving
  within the pause; typing whispers not limited; Enter sending during composition; the edit window never closing; no resync
  after reconnecting; the message `POST` not opting in to `429` retry; a reply still quoting a deleted message.
- Real Chromium, two signed-in people (Eh Doh and Paw) against the running API, queue worker and Reverb: **80 checks pass**
  (36 for the everyday flow, 44 for history, reconnect, groups, drawer and touch).
  - Typing appears and disappears after 4 s; a message appears at once as "Sending…", settles without duplicates, and arrives
    once for the other person; with the API refusing, it is tried 3 times with the same `client_id`, shown as "Not sent", and
    "Tap to retry" results in exactly one copy on the server; reply, edit, delete (confirm dialog, Escape keeps), and the
    reply that quoted a deleted message says so; a picture with caption and a file arrive, open and download.
  - 73 messages: only the newest 30 are loaded, scrolling to the top loads the next 30 without a jump, "Jump to latest".
  - Reverb was stopped and started again: the banner appears, nothing arrives meanwhile, then what was sent, edited and
    deleted while away is repaired on reconnect, with no duplicates.
  - Group: created from the picker, the other person gets it live, a rename and a removal are live, the removed person is taken
    back to her list with a note and the server answers `403`; a new direct chat; the encrypted notice; the drawer (tab,
    list, conversation without navigating, collapse, unread count on the tab, state kept across a reload); the phone sheet
    (Reply and Copy for someone else's message), Enter making a new line on touch.
  - **axe-core** (WCAG 2.0/2.1 A and AA plus best practices): no violations on the chat list, the conversation, the new
    group dialog, group info, the encrypted chat, the drawer and the phone conversation. No console errors or Vue warnings.
- Not verified here: Safari and Firefox (only Chromium was available); a real touch device (touch was emulated); typing with a
  Burmese or Karen keyboard (the IME guard is tested with composition events only); screen readers (axe, not a person).

### Real bugs the browser run found (all fixed, with a test)

1. The first conversation load never showed (stuck skeleton): `timelines[id] ??= {...}` hands back the plain object, not the
   reactive one, so the update was invisible. Same pattern in the drafts store.
2. The send response was wrapped (`{ data }`) while the documentation showed it bare (see above).
3. The unread count on the server kept growing while a chat was open: the read report needed a local unread message.
4. A read report that was waiting when the person left the chat was lost.
5. A reply kept quoting a message that had been deleted.
6. The online dot was read out before the person's name.
7. The time on the selected (blue-tinted) chat row was too faint to pass the contrast check.
8. The new-chat picker missed the members of groups when it was opened before the list had arrived.
9. A failed message looked sent (now a red outline, "Not sent", Tap to retry, Discard).

### Backend gaps and notes found in this phase

- `docs/API.md` showed the `POST /chats/{chat}/messages` answer unwrapped, but the server wraps it in `data`. **Corrected in
  the document**; the client accepts both.
- Texts the server writes into messages (for example "Naw Paw started a video room") and its error messages are English
  only. They are shown as they are, apart from system notices, which we write ourselves when the host is known.
- The chat list does not include the members, so the preview of a system notice cannot name its host (see above).
- `message.updated` and `message.deleted` are sent on the chat channel only. A chat that is not open shows an old preview after
  an edit or delete until the next refetch. Sending them on the user channel as well would fix that with no client change.
- `unread_count`: sending a message moves your read position to it, so everything before it counts as read, even messages you
  never opened (checked against the running API: 3 unread became 0 after sending one message). Reasonable, but
  `docs/API.md` only says "messages from others after your read position"; worth one sentence there.
- No user search, so a new chat can only start with someone from your existing chats (known, from Phase 1).
- Nothing blocked the phase.

## Phase 3: Feed and sidebar

- [x] **Feed service behind an interface** (`src/services/`), mock implementation in `src/mocks/`, chosen by `VITE_FEED_SOURCE`
  (`mock` now, `api` later). Calls answer after 150–400 ms; likes, comments and new posts are kept in `localStorage`;
  Karen author names, everyday community captions, images from `picsum.photos/seed/…`.
  - Components and the store only know `FeedService` (`listPosts`, `createPost`, `likePost`, `unlikePost`, `listComments`,
    `addComment`, `postLink`). The shapes (`src/types/feed.ts`) follow the real API's conventions: cursor pages, ISO times,
    `PublicUser` for people, `ApiError` for failures (a missing post is a `404`, a bad caption a `422` with the field named).
  - `VITE_FEED_SOURCE=api` is a stub that answers "the backend has no feed endpoints yet" (`501`). It does **not** quietly show
    sample posts, so nobody mistakes demo content for a working server. When the endpoints exist, `src/services/apiFeedService.ts`
    is the only file to write.
  - 30 sample posts (a market day, a school plant sale, a garden, notices, a boat race…), some with comments, by Saw Htoo,
    Naw Paw, Saw Kler and Naw Mu. Dated relative to "now", so the feed always looks recent; comments are never from the future.
  - What is kept in the browser: your posts, your comments and your likes (per person, so two people sharing a browser do not
    share likes) under one key (`kc.mock.feed`, versioned). Anything that is not what we wrote is ignored, not trusted.
  - A picture chosen for a post is shrunk to a 900 px JPEG and kept as a `data:` address (the browser's storage is small,
    about 5 MB for everything). If it is full, the oldest pictures go first, then the oldest posts; the newest stays.
- [x] **Post cards**: author avatar and name, relative time ("5 min. ago", full date on hover), image in a fixed square box with
  lazy loading, caption (links work, markup never does; long captions are cut with "more").
  - The first two posts' pictures load at once, the rest when they come near the screen. A picture that fails to load leaves a
    calm "Picture not available" in the same box.
  - Relative time uses the browser's own `Intl.RelativeTimeFormat` (English for a language it does not know, such as S'gaw Karen).
- [x] **Like**: toggles with one small scale animation (not shown for an unlike, and practically instant with "reduce motion"),
  count kept in step (and put back if the request fails).
  - Optimistic: the heart changes at once. Quick repeated taps are sent one after the other in order, the screen takes the
    server's numbers when the last answer is in (so it never flickers through the in-between answers), and if the server
    refuses it goes back to what the server last confirmed, with one toast for the whole run of taps.
  - The heart is filled in the brand blue (`danger` is for errors only).
- [x] **Comments drawer**: bottom sheet on phones, side drawer from 768 px (the shared `Modal`, now with `placement="side"`);
  comments (oldest first, "Show more comments") and an input; focus trap, Escape, focus returns to the button that opened it.
  - The comment box is pinned under the list. On a screen with a mouse it has the cursor at once; on a phone it does not
    (that would open the on-screen keyboard before anyone chose to type). Enter sends with a mouse and never while an input
    method is composing a word; on touch Enter is a new line and the button sends. A refused comment keeps its words.
- [x] **Share**: Web Share API where available, otherwise copies a link and shows a toast.
  - Closing the share sheet is not an error. If the share sheet refuses for another reason the link is copied instead; if
    copying fails too, a toast says so. The link is `/?post=<id>`: it opens the feed (there is no page for one post yet).
- [x] **Infinite scroll** with a skeleton while loading; empty and error states with "Try again".
  - The next page is fetched when the end of the list is within 600 px of the screen. A failed page shows "More posts could not
    be loaded." at the end (the posts stay) with "Try again". At the end: "You have seen all the posts." A browser without
    `IntersectionObserver` gets a "Show more posts" button instead.
- [x] **Preview note** at the top of the feed ("Preview — sample posts. Posting is not live yet."), dismissable.
  - *Decision:* the note comes back at the next visit (it is not remembered), since its job is to stop sample posts from being
    taken for real ones.
- [x] **Create modal: Post**: caption, drag-and-drop zone that also opens the file picker (`accept="image/*"`, so phones offer
  the camera), preview, images up to 10 MB, new post at the top of the feed through the mock service.
  - A file that is not a picture, or is over 10 MB (10 MB exactly is accepted), is refused with a message before anything else
    happens. A picture the browser cannot draw is taken away again with a message. A file dropped a little beside the zone no
    longer makes the browser leave the page. The words and the picture are kept when posting fails.
  - After posting: the dialog closes, a toast says it is on the feed, and a person who was on another page is taken to the feed.
  - The preview is capped at 256 px (the same square the feed shows) so the Post button stays in view on a laptop.
- [x] **Create modal: Start a meeting**: `POST /rooms` (instant room), then `/rooms/:id`.
  - *Decision:* it starts at once, named "{your name}'s meeting" (the API requires a `name` and the prompt does not ask for a
    field). Naming, passwords, a waiting room and a chat link come with the "New meeting" form in Phase 4.
  - **`/rooms/:id` is still a placeholder until Phase 4**, so the room exists on the server but nobody can join it yet. The server
    ends rooms that nobody joins after a while (`rooms:end-stale`).
  - A failure stays in the dialog, in words ("Can't reach the server…", the server's own reason for a `422`), and can be retried.
- [x] **Right sidebar, Online now**: people from your chats whose presence is `online` (`GET /users/presence`); a click opens
  or creates the direct chat (`POST /chats/direct`).
  - "People from your chats" means the other person of each direct chat and the members of groups the app has opened (the five
    the sidebar opens, and any opened for the new-chat picker). The lookup runs when the chat list arrives, when new people
    become known (grouped into one request) and every 60 seconds while the page is visible.
  - Shows eight with "Show more"; a count; loading, "Nobody is online right now", "We could not check who is online" with
    "Try again"; people already shown are kept when a later lookup fails.
- [x] **Right sidebar, Upcoming meetings**: `GET /rooms?filter=upcoming`, each with a Join button.
  - Name, start time in the person's own zone, host ("You are the host"), "In progress" for one already started. Join is a link to
    `/rooms/:id` (a placeholder until Phase 4).
  - Kept fresh: asked when first shown, every 5 minutes while the page is visible, when the person comes back after a minute or
    more, and **at once when a meeting is announced in one of your chats** (the `room_created` system message). Checked live
    with two people: a meeting Paw scheduled for the group appeared in Eh Doh's sidebar with no reload.
- [x] **Right sidebar, People from your groups**: members of up to 5 of your group chats (`GET /chats/{id}`) with whom you have
  no direct chat yet, cached for the session, each with a "Message" button.
  - The five are the most recently active groups. Members are asked for once (the chat store keeps them for the session) and
    only once when several screens ask at the same time. Messaging someone takes them off the list (there is a chat now).
- [x] **States and accessibility**: skeleton, empty and error state for every list; touch targets, labels, focus, contrast.
  - Every list has a loading state (announced to screen readers), an empty state that says what to do, and an error state with
    "Try again". An axe scan found no violations on Home with the sidebar, the comments drawer and sheet, both steps of the Create
    dialog, the activity sheet and Home on a phone. Buttons and links on the feed and in the sheets are at least 44 × 44 px.
  - *Addition:* below 1024 px, where there is no right column, Home has a **"People & activity"** button that opens the same three
    parts in a sheet. Without it, "Join" and "Message" would have no way in on a phone. The right column is not made at all
    below 1024 px, so a phone does not fetch meetings or group members it never shows (checked: no `/rooms` request until the
    sheet is opened).
- [x] **Tests**. See "Verification" below.
- [x] **Verification** in a real browser against the running backend (two people), with an axe scan. See below.

### Verification (Phase 3)

- `npm run build`, `npm run type-check` and `npm run test` pass: **817 tests in 62 files** (Phase 2 ended at 531 in 41). The suite
  was run three times in a row to look for flaky tests. The backend was not touched in this phase.
- New tests cover the feed service (paging by cursor with a post added meanwhile, per-person likes, persistence, damaged
  storage, a full browser store), the feed store (optimistic likes, ordering of quick taps, rollback, paging, comment threads),
  the rooms and presence stores, the sidebar parts, the Create flow, the comments drawer (including Burmese/Karen keyboard
  behaviour and phone behaviour), the drop zone, the infinite scroll with a fake observer, and the shared `Modal` options.
  Tests run the real API client, router and stores with only the network (and the sample feed's pause) replaced.
- Mutation checks: 29 behaviours were broken on purpose, one at a time, and a test failed each time (for example: a refused like
  not put back, quick taps sent in parallel, the next page repeating posts, a second like counting twice, likes shared between
  people, a 10 MB picture refused, a file dropped beside the zone leaving the page, Enter sending while a word is composed,
  people you already chat with offered again, all groups opened instead of five, the sidebar made on narrow screens). Two broke
  nothing at first: one test could not tell grouped from separate presence lookups (now it can), and one list of "look again"
  triggers in the feed turned out to be redundant (removed).
- Real Chromium, two signed-in people against the running API, queue worker and Reverb: **94 checks pass** (64 on desktop, 30
  on a phone and a tablet), and the 80 checks of Phase 2 still pass.
  - Desktop: the feed (6 posts, square boxes, eager and lazy pictures), likes (at once, after the delay, after a reload, with the
    keyboard), the comments drawer (side drawer, cursor in the box, Enter sends, Escape closes and returns focus, survives a reload),
    share (clipboard fallback and a share sheet), scrolling to the end (30 posts, each once, a skeleton shown), Create (12 MB refused,
    a text file refused, a good picture previewed, removed, dropped by drag-and-drop, a post that appears first with a small
    picture, survives a reload, from another page ends on the feed), Start a meeting (a real instant room on the server, hosted by
    the person), and the sidebar: "People from your groups" → Message opens the chat in the drawer without leaving the page;
    a scheduled meeting made by someone else appears without a reload; Paw appears in "Online now" within a minute; Join
    opens the room page.
  - Phone and tablet: bottom sheets (comments, activity, Create), no on-screen keyboard forced open, Enter is a new line on touch,
    the toast above the bottom bar, "Message" opening the chat page, no sidebar below 1024 px (and it comes and goes when the window is
    resized), no `/rooms` request until the sheet is opened, the like animation practically off under "reduce motion".
- Not verified here: Safari and Firefox (only Chromium was available); a real touch device and the real Web Share sheet (touch
  was emulated, the share sheet stubbed); the pictures from `picsum.photos` themselves (the sandbox cannot reach it, so a drawn
  picture with the same address pattern was served); typing with a Burmese or Karen keyboard.

### Real problems found while building this phase (all fixed, with a test)

1. Sample comments were dated after "now" (a comment "now" under a post from 25 minutes ago).
2. The drop zone flickered while a file crossed its own text (`dragleave` fires for children).
3. A file dropped just outside the zone made the browser open it and leave the page, losing the post.
4. The picture preview was a full-width square, which pushed the Post button below the fold on a laptop-height window.
5. After removing the picture the focus was lost (the button that had it was gone).
6. The new-chat picker and the sidebar could each ask the server for the members of the same group at the same moment; the
   second request now joins the first.

### Backend gaps and notes found in this phase

- No feed endpoints (as in the prompt): feed, posts, likes, comments and shares are all sample data, listed in the README.
- `GET /rooms?filter=upcoming` lists **scheduled** rooms only. A meeting someone starts right now in a chat reaches the
  person as the `room_created` notice inside the chat ("Join meeting") and in `GET /rooms` without a filter, but not in
  "Upcoming meetings". Worth deciding whether the sidebar should also show meetings that are live now.
- `POST /rooms` requires a `name`; there is no server default, so "Start a meeting" makes one up (above).
- A room not linked to a chat can be opened by anyone who has its id, but there is nothing in the interface yet to share the link
  (Phase 4).
- The chat drawer is docked in the same bottom-right corner as the sidebar, so an open drawer covers the lower part of it (the
  collapsed tab does not: the sidebar leaves room for it). This follows the layout in the prompt; collapsing the drawer
  brings the sidebar back.
- Nothing blocked the phase.

## Phase 4: Video

Not started.

## Phase 5: Push and polish

Not started.
