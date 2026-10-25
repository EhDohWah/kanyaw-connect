# Mobile progress

The Android and iOS app, in parts 8A to 8F of the Phase 8 prompt. A part is done when every item is ticked,
`npm run lint`, `npm run type-check` and `npm test` pass here, `php artisan test` and Pint pass at the root, and this
file is up to date. Checks that need a real phone are written down with the phone model, the OS version and the date,
and are never ticked from an emulator. Where the app deliberately differs from the web app, it says so next to the item.

| Part | Status |
|---|---|
| 8A. Foundation | Built; waiting for your review and the device check below |
| 8B. Backend: native push, call pushes, account deletion | Not started |
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
- *Testing Library 14:* `fireEvent` returns a promise and must be awaited; un-awaited events overlapped and lost typing.

### Device check (you)

Done when a development build, on a physical phone and against the local backend:

- [ ] signs in;
- [ ] shows the chat list (an empty list is fine);
- [ ] keeps its token after the app is killed and opened again;
- [ ] signs out.

Also worth a look on the same phone: Burmese and S'gaw Karen text (Profile → Language), the offline banner (turn on
airplane mode), and a `kanyawconnect://chats/<id>` link (`npx uri-scheme open kanyawconnect://chats/<id> --android`).

How to run it: `cp .env.example .env` and put your computer's LAN address in it, start the backend as its README describes
for phones, then build once with `eas build --profile development` (or `npx expo run:android` with Android Studio) and
start the bundler with `npm start`. This needs the Expo account (prerequisite for 8A).

| Check | Phone | OS | Date | Result |
|---|---|---|---|---|
| Sign in, chat list, kill and reopen, sign out | | | | |
