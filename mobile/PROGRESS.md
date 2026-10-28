# Mobile progress

The Android and iOS app, in parts 8A to 8F of the Phase 8 prompt. A part is done when every item is ticked,
`npm run lint`, `npm run type-check` and `npm test` pass here, `php artisan test` and Pint pass at the root, and this
file is up to date. Checks that need a real phone are written down with the phone model, the OS version and the date,
and are never ticked from an emulator. Where the app deliberately differs from the web app, it says so next to the item.

| Part | Status |
|---|---|
| 8A. Foundation | Built; reviewed by you on 26 Oct 2026, runs on a Redmi Note 11 (two device checks still to confirm, below) |
| 8B. Backend: native push, call pushes, account deletion | Done for Android: test push and message notifications confirmed on the Redmi (27–28 Oct 2026). iOS waits for the Apple keys |
| 8C. Messaging and voice messages | Not started |
| 8D. Meetings | Not started |
| 8E. One-to-one calls (native ringing) | Not started |
| 8F. Notifications, settings, accessibility, performance, release | Not started |

## Versions and platform floors (checked 25 October 2026)

- **Expo SDK 58** (58.0.19, React Native 0.88, React 19.3, TypeScript 6.0). SDK 58 is the newest stable release; there is
  no SDK 59 yet. Expo Router 58.0.26.
- **Android:** `minSdkVersion` **24** (Android 7), `compileSdkVersion` 37, `targetSdkVersion` **36**: Expo SDK 58's
  defaults, checked in the generated Gradle files after `expo prebuild`. LiveKit's React Native SDK also needs 24. If 8E
  chooses `expo-callkit-telecom`, the floor rises to 26.
- **iOS:** deployment target **16.4** (Expo SDK 58's floor; LiveKit's podspec says 10.0, which is only a floor).
- **Node** 22.13 or later (CI uses Node 22).

## 8A · Foundation

- [x] **Project.** `mobile/` was created with `create-expo-app` (SDK 58 template) and trimmed: the demo screens, the web
  packages and Expo's own licence file are gone. TypeScript strict (plus `noUncheckedIndexedAccess`), Expo Router with the
  routes in `mobile/app/`, ESLint (Expo's flat config with Prettier; `no-console` is an error, see hard rule 4), Prettier,
  Jest with `jest-expo` and React Native Testing Library 14.
  - `app.config.ts`: the name, the scheme `kanyawconnect`, the placeholder bundle identifier `org.example.kanyawconnect`
    (one constant, `BUNDLE_ID`), the photo, camera and microphone reasons, and the plugin list.
  - `eas.json`: `development` (development client, internal, APK), `preview` (internal, APK) and `production`
    (version numbers counted up by EAS). No `channel` fields: those need `expo-updates`, which is not used.
  - The app icon and splash image are still Expo's template pictures; the real ones come with the store listing (8F).
  - The generated `ios/` and `android/` folders are ignored by git and were deleted after each `expo prebuild` check.
- [x] **Native dependencies.** `@livekit/react-native` 3.1.0, `@livekit/react-native-webrtc` 150.1.0, `livekit-client`
  2.23.0, LiveKit's Expo plugin 1.1.0 and `@config-plugins/react-native-webrtc` 15.0.2. `react-native-webrtc` itself is
  not installed (the two cannot live together).
  - *Checked:* after `expo prebuild`, the Podfile has `source 'https://github.com/livekit/podspecs.git'` above
    `source 'https://cdn.cocoapods.org/'`. The LiveKit plugin writes it; nothing was edited by hand.
  - *Checked:* the `@livekit/react-native` README still says "This is v2 of the React-Native SDK", but the changelog shows
    3.0 moved to LiveKit's own prefixed WebRTC build, and 3.1.0 is current. The README line is out of date.
  - *OS rule:* the WebRTC plugin adds `SYSTEM_ALERT_WINDOW` ("draw over other apps"). The app does not need it, and the
    Play Store asks for a reason. `android.blockedPermissions` removes it from the release manifest (`tools:node="remove"`;
    the debug manifest keeps it). A config plugin cannot remove it, because Expo writes the permission list after every
    plugin has run.
  - `WRITE_EXTERNAL_STORAGE` comes from `expo-file-system` and is limited to Android 12 and older (`maxSdkVersion` 32).
- [x] **Design tokens.** `src/theme/tokens.ts` holds the 30 colours from `frontend/src/style.css`, spacing, radii, font
  sizes and the 48-point touch target. A test reads `style.css` and fails when a value differs.
- [x] **Myanmar font.** Noto Sans Myanmar (Regular, Medium, SemiBold, Bold, with its OFL licence) is bundled with the
  `expo-font` plugin, so nothing is downloaded. Burmese and S'gaw Karen text gets the font and a 1.8 line height
  (`textStyleFor`); `includeFontPadding` is never turned off. On iOS each weight is named by its PostScript name, because
  two of the files call their family "Noto Sans Myanmar Medium" and "… SemiBold".
  - *Checked in the font files:* the whole Myanmar block, every S'gaw Karen letter (U+1061–1064), Pwo Karen, Extended-A
    and Extended-B are covered. How it looks on a phone is part of the device check.
- [x] **i18n.** `src/i18n/locales/*.json` are the web app's files, unchanged (653 keys). `npm run i18n:check` fails when a
  file differs from the web's or the key sets differ; `npm run i18n:copy` copies them over. A test compares the files
  too. The app adds no key of its own: every text on the phone is one the web already has.
  - i18next reads the web's `{name}` placeholders (prefix `{`, suffix `}`), and `plural()` picks vue-i18n's
    `zero | one | many` forms.
  - The language is the account's, else the phone's (if it is one of the three), else English.
- [x] **API client** (`src/api/http.ts`, ported from the web with its tests): the token on every request, `X-Socket-ID`
  on requests that change something, a `401` for the current token signs out (a late `401` for an old token does not),
  `429` waits for `Retry-After` on safe requests (up to 10 seconds) and otherwise becomes a message, and every failure is
  one `ApiError`.
- [x] **Auth.** Register, sign in and sign out (`src/stores/auth.ts`, Zustand).
  - `device_name` is the phone's model and system, for example "Pixel 7 (Android)" (`expo-device`).
  - The token and its expiry are kept with `expo-secure-store` (Keychain on iOS, Keystore on Android), with
    `AFTER_FIRST_UNLOCK` on iOS. A test checks every write uses it. Nothing goes to AsyncStorage.
  - A token past its expiry is dropped at start without asking the server, and the sign-in screen says the session ended.
    No connection at start keeps the token and offers "Try again" instead of signing out.
  - Sign out runs the "before sign-out" hooks while the token still works, then revokes the token, then forgets it. 8B
    adds removing this phone's native push registration as one of those hooks (`onBeforeSignOut`).
  - *Not in 8A:* "Forgot your password?" and email verification (Phase 7). Their links point at the web app, so the phone
    does not need its own screens for them yet.
- [x] **Shell.** Bottom tabs: Home, Messages (with the unread count), Create (opens a sheet; you stay where you were),
  Meetings, Profile. A conversation, a meeting, a call and Settings open over the tabs, so the tab bar is hidden there.
  - The sign-in and create-account screens and the signed-in screens are guarded with `Stack.Protected`: only one side
    exists at a time, and signing in or out clears the history.
  - Deep links `kanyawconnect://chats/:id`, `kanyawconnect://rooms/:id` and `kanyawconnect://calls/:id` open their
    screens (placeholders until 8C, 8D and 8E). Signed out, they lead to sign-in.
  - The offline banner shows when NetInfo says the phone has no network, or the live connection is down (the same rule
    as the web, with NetInfo instead of `navigator.onLine`).
  - *Placeholders:* Home (the real feed comes after Phase 8), Meetings (8D), and the two Create options, which say
    "Coming soon".
- [x] **Real-time.** `laravel-echo` with the React Native build of `pusher-js` (`pusher-js/react-native`). The manager is
  the web's, ported with its tests; mobile adds `pause()`.
  - It connects after sign-in. In the background it closes, unless a call is running (8E tells it); back in the
  foreground it reconnects, and the "connected" signal refetches what may have been missed (for now the chat list; 8C and
  8E add the open chat and `GET /calls/current`). iOS's `inactive` state (Control Centre, the app switcher) changes nothing.
  - *Risk:* the `pusher-js` README marks React Native support as deprecated in favour of Pusher's native SDK, which does
    not speak to Reverb. It works today; if it breaks, the fallback is a small WebSocket client for the Pusher protocol.
  - *For now:* every chat event refetches the first page of the chat list (once per burst). 8C ports the web's chats
    store, which applies each event by itself.
- [x] **Heartbeat.** `POST /me/heartbeat` every 45 seconds, only while the app is in the foreground (AppState `active`);
  one is sent on coming back (never faster than every 10 seconds); failures back off, `429` waits for `Retry-After`, `401`
  stops it. Ported from the web with its tests.
- [x] **Chat list.** `GET /chats` (30 at a time, more on scrolling), pull to refresh, the empty state, an error state with
  "Try again". Each row is ported from the web: photo or initials, name, time in the person's time zone, the last message
  (with the web's preview rules and their tests), the unread badge, pinned and muted marks, read out as one sentence.
- [x] **Profile.** Name, phone, time zone, language and photo.
  - The photo comes from the system photo picker, which asks for no permission (it only hands over the photo you choose).
    It is shrunk on the phone to at most 1600 px on its longest side and under 2 MB (`expo-image-manipulator`, saved as
    JPEG, trying lower qualities if needed) before upload. JPEG, PNG and WebP that already fit are sent untouched; iPhone
    HEIC photos are converted. GIF, SVG and anything else are refused before anything is sent.
  - The picture is decoded at the target size, so a 12-megapixel photo does not run a 2 GB phone out of memory.
  - The time zone list shows the common zones first, then every zone the phone knows. *To check on a phone:* Hermes may
    not list all zones (`Intl.supportedValuesOf`); then only the common ones and the account's own zone are offered.
- [x] **Settings.** A skeleton: who is signed in, and "Sign out". The rest arrives in 8F.
- [x] **Tests** (168, `npm test`): the auth store; the API client's error and token handling; the locale files against
  the web's; the token values against `style.css`; shell navigation (the guards, every tab, the Create sheet, all three
  deep links, sign-in, sign-out, an expired or refused token, no connection at start); the real-time manager and its
  background rules; the heartbeat; the chat list store; photo preparation; and the ported date and preview rules.
  - The shell tests render the real `app/` routes (`src/testing/renderApp.tsx`). Expo Router's own `renderRouter`
    switches to fake timers, which stalled the app's own waiting (secure storage, requests, a redirect made while the
    saved session is read) and leaked into the next test, so the helper renders the same root with real timers.
- [x] **CI:** `.github/workflows/mobile.yml` runs the locale check, lint, type check, tests and `expo config` when
  `mobile/`, the web's locale files or `style.css` change.

### Found while building

- *Routing:* with the sign-in screens in their own group (`(auth)`), a signed-out start at `/` never settled on the
  sign-in screen. They now sit directly in the root stack, as in Expo's own example, and land correctly.
- *Expo Router 58* renamed `unstable_settings.initialRouteName` to `anchor`.
- *Sign-in ↔ create-account:* "Create account" opens over sign-in, and "Sign in" there goes back (as does the back
  gesture), instead of replacing one screen with the other. In the tests, the replacing link left the router stuck.
- *Backend test fix:* `CallActionsTest` "refuses a link that was changed" set the signature's first character to `0`, so
  1 time in 16 the link was unchanged and (rightly) accepted. It now always changes the character. Found when the
  backend suite failed once during the 8A checks; 1292 of 1292 pass.
- *Found on the phone (26 October 2026):* signing in crashed with "Object cannot be used as a constructor". The React
  Native build of `pusher-js` is CommonJS and exports `{ Pusher }`, although its types declare a default export, so the
  default import handed Echo the wrapper object. `src/realtime/echo.ts` now takes `.Pusher`, and a test checks that Echo
  gets a class. The shell tests replace the Echo factory with a fake, which is why they did not catch it.
- *Tabs and the back button:* the tab bar now uses `backBehavior="initialRoute"`: Android's back button returns to Home
  from another tab, then leaves the app. (Expo Router warned that the `index` anchor needs it.)
- *Testing Library 14:* `fireEvent` returns a promise and must be awaited; un-awaited events overlapped and lost typing.

### Device check (you)

Done when a development build, on a physical phone and against the local backend:

- [ ] signs in;
- [ ] shows the chat list (an empty list is fine);
- [ ] keeps its token after the app is killed and opened again;
- [ ] signs out.

Also worth a look on the same phone: Burmese and S'gaw Karen text (Profile → Language), the offline banner (turn on
airplane mode), and a `kanyawconnect://chats/<id>` link (`npx uri-scheme open kanyawconnect://chats/<id> --android`).

How to run it: [docs/android-on-windows.md](docs/android-on-windows.md) (Windows PC, Android phone on USB, the setup we
used, with every problem we hit and its fix). An EAS cloud build (`eas build --profile development`) also works and needs
the Expo account.

| Check | Phone | OS | Date | Result |
|---|---|---|---|---|
| Build, install and open the development app | Xiaomi Redmi Note 11 (2201117TG) | Android 13 | 26 Oct 2026 | Works over USB (`adb reverse`) |
| Sign in | Xiaomi Redmi Note 11 (2201117TG) | Android 13 | 26 Oct 2026 | Works (as user2, after the `pusher-js` fix) |
| Chat list | Xiaomi Redmi Note 11 (2201117TG) | Android 13 | 26 Oct 2026 | Works: 2 chats, previews, times, unread badge 3 on the tab |
| Tabs, Create sheet, opening a chat, Settings | Xiaomi Redmi Note 11 (2201117TG) | Android 13 | 26 Oct 2026 | Work as built (placeholders where 8C/8D come later) |
| Kill and reopen (token kept), sign out | Xiaomi Redmi Note 11 (2201117TG) | Android 13 | 26 Oct 2026 | Not shown in the screenshots; to confirm |
| Burmese and S'gaw Karen text | | | | Not checked yet |

Seen on the phone (27 October 2026): the Profile photo area stayed empty while the photo was still loading (an
address the phone cannot reach only fails after a long timeout). The initials now show until the photo has loaded,
with a test.

Seen on the phone: one person's photo did not load and the row showed an empty circle. The avatar now falls back to the
initials when a photo fails, as on the web (with a test). The photo addresses come from the backend's `APP_URL`; on a
phone they must use an address the phone can reach (`http://127.0.0.1:8000` over USB with `adb reverse`).

## 8B · Backend: native push, call pushes, account deletion

All in the Laravel app at the root; nothing in `mobile/` yet (the app registers its token in 8F, and rings in 8E).

- [x] **Phone registrations.** Table `native_push_tokens` (platform, token, optional PushKit `voip_token`, app version,
  last seen), each tied to the login it was made with, so signing out removes it.
  - `POST /push/native-tokens`: safe to repeat (the same token refreshes its row and answers `200`), a token that
    arrives for another account moves to the current one, a PushKit token moves with it, `voip_token` only on iOS,
    at most 20 phones per user, 20 requests per hour, and it needs the bearer token from sign-in.
  - `DELETE /push/native-tokens/{id}`: owner only; anyone else gets `404`.
- [x] **Senders.** No package: both services are called directly with Laravel's HTTP client, behind the
  `NativePushSender` interface, with a fake for tests. `firebase/php-jwt` (actively maintained, Google's own PHP
  library uses it) signs the two kinds of token the services want.
  - FCM HTTP v1: an OAuth token made from the service-account key (RS256), cached until shortly before it expires.
  - APNs over HTTP/2: a provider token signed with the `.p8` key (ES256), cached for 50 minutes; headers
    `apns-push-type`, `apns-topic` (the bundle identifier, or `<bundle>.voip`), `apns-priority`, `apns-expiration`.
  - *Checked:* the production Docker image's curl (8.14.1) speaks HTTP/2, which APNs requires.
  - A token FCM or APNs reports as no longer valid is deleted; a dead PushKit token only loses the phone its ringing.
    Logs carry the platform, the HTTP status and the error reason: never a token or a payload (a test checks).
- [x] **Message pushes,** under the web-push rules (not the sender, not a muted chat, not someone whose app is open):
  Android, a notification on channel `messages`; iOS, an alert grouped by chat. Encrypted chats say "New message" only.
  Only the channels that can reach a person are queued (a phone-only person costs no web-push job).
- [x] **Call pushes.** `call.incoming` goes to every phone: a VoIP push on iOS (topic `<bundle>.voip`, priority 10,
  expiring at `ring_expires_at`), a high-priority FCM data message on Android whose TTL is the seconds left, with the
  6B payload including `decline_url`. `call.ringing_over` `{type, call_id, reason}` is new: sent the same way when the
  ringing stops (`answered`, `declined`, `cancelled`, `no_answer`, including the timeout job and the stale-call
  clean-up). `call.missed` is an ordinary alert (Android channel `missed-calls`), never a VoIP push. Call pushes are
  never retried; message and missed-call pushes are retried a few times when the service had a problem.
  - *Later (8E):* if 8E picks `expo-callkit-telecom`, the Android copy of `call.ringing_over` becomes its `callEnded`
    data message.
- [x] **Account deletion,** `DELETE /me` with `{ password }`: a wrong password is `422` and changes nothing.
  - Removed: every session, push registration and encryption device (contacts get `device.revoked`), the profile and
    avatar, group memberships (ownership passes on; an empty group is deleted), every file the account uploaded, and
    pending reset links. A ringing or ongoing call ends; video rooms it hosts end.
  - Kept: its messages in other people's chats, and calls in their history, from "Deleted user" (with
    `is_deleted: true` on the person in the API).
  - *Changed from the default, and why:* the users row is not deleted but emptied and soft-deleted (name "Deleted user",
    unusable email and password). Messages, calls and direct chats point at it, and a hard delete would either cascade
    away the other person's call history or leave the direct chat without anyone on the other side. For the same reason
    the account stays a member of its **direct** chats (groups are left): the other person still sees who the
    conversation was with, and calling it is refused. The email address can register again.
- [x] **Docs:** docs/API.md (both endpoints, the token object, `DELETE /me`, `is_deleted`, section 6.4 on phone push,
  the phone transports and `call.ringing_over` in 8.2, rate limits), the Postman collection, the README (settings,
  "Phone push (FCM and APNs)", "Deleting an account", deployment checklist, troubleshooting) and `.env.example`.
- [x] **For the test push** (pulled forward from 8F, because a real push needs a phone that registered its token):
  - the app: *Notifications on this phone* in Settings (permission asked only when it is switched on; the Android
    channels `messages` and `missed-calls`; the token registered with the server, re-registered at every start and
    when the system changes it, and tied to the person, so whoever signs in next on the phone does not inherit it);
    `google-services.json` is read from `mobile/` or `GOOGLE_SERVICES_JSON` and kept out of git;
  - the server: `php artisan push:test <email>`, which sends one notification right away to that account's phones and
    prints each push service's answer (no tokens).
  - *Still 8F:* localised channel names, the `calls` channel, opening the chat when a notification is tapped, the
    explanation after sign-in.
- [x] **A real test push to your phone** (run by you, 27 Oct 2026, Xiaomi Redmi Note 11, Android 13, backend in
  Docker): `push:test` answered `sent` every time and the notification appeared. Found on the way: the backend `.env`
  needs `FCM_CREDENTIALS` (Docker reads it only when the containers are recreated, `docker compose up -d`), and
  `google-services.json` belongs in `mobile/`, the service-account key on the server.
- [x] **A message notification with the app in the background** (you, 28 Oct 2026, Redmi Note 11, Android 13): a
  message sent from the web arrived as a notification. Needed first: the `message_kind` fix (see below). Note for 8F:
  on Xiaomi, swiping the app away can stop it completely, and Android then delivers no push until it is opened again;
  the app should point people to Autostart and "No restrictions" battery saving.
- [ ] **iOS:** not tried yet (needs an Apple Developer membership and the APNs key).

### Found while building

- *Found with your phone (27 Oct 2026):* message notifications never arrived on Android, while `push:test` did. FCM
  refused them (400 `INVALID_ARGUMENT`) because their data had a `message_type` key, a name FCM keeps for itself. On
  Android it is now `message_kind`; building an FCM message with any reserved key (`from`, `message_type`, `google…`,
  `gcm…`) now fails in the tests instead of at Google; and the log names the field FCM objected to. The test fake
  had accepted any key, which is why the tests did not catch it.
- The Android TTL of a call push was counted with PHP's `time()` instead of Laravel's clock, so it ignored the clock in
  tests; a test that moves time caught it.
- The guard test "never holds a private key of a user" now also allows the push sender, which reads the server's own
  Firebase and APNs keys (like the VAPID key already allowed there).
- `ErrorOutputTest` used `DELETE /me` as its example of a method the API refuses; it now uses `PUT /me`.

### Waiting for you

- A Firebase project with an Android app registered as `org.example.kanyawconnect` (or the real package name), and
  its service-account JSON key.
- Whether you have an Apple Developer Program membership; if so, an APNs `.p8` key with its Key ID and your Team ID.
- Optionally the real bundle identifier, to replace the placeholder everywhere at once.

