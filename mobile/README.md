# Kanyaw Connect for Android and iOS

The phone app for Kanyaw Connect: React Native with Expo (SDK 58), TypeScript, Expo Router and Zustand. It talks to the
same Laravel API as the web app in `../frontend` and shows the same texts. Progress, decisions and the checks that need
a real phone are in [PROGRESS.md](PROGRESS.md).

The app runs as an Expo **development build**, not in Expo Go: calls (from 8E) need native code that Expo Go does not
have.

## Running it on a phone

**On Windows with an Android phone on USB**, follow [docs/android-on-windows.md](docs/android-on-windows.md): the
one-time setup (long paths, memory, Java, Android SDK, ninja, Xiaomi settings), the two-window daily routine, and a fix for
every error we met.

Otherwise (any computer, phone on the same Wi-Fi):

1. **Backend.** Start it so a phone can reach it: see "Using it from another device" in the [main README](../README.md).
   A phone cannot reach `localhost` on your computer, so everything uses your computer's address on the local network.
2. **Settings.** `cp .env.example .env` and put that address (for example `192.168.1.20`) in `EXPO_PUBLIC_API_BASE_URL`
   and `EXPO_PUBLIC_REVERB_HOST`. These values end up inside the app; none of them is a secret.
3. **Install:** `npm install` (Node 22.13 or later).
4. **Build the development app once**, and again whenever a native package or `app.config.ts` changes:
   - with EAS (needs an Expo account): `npx eas build --profile development --platform android` (or `ios`), then install
     the build on the phone;
   - or locally, with Android Studio or Xcode: `npx expo run:android` / `npx expo run:ios`.
5. **Start the bundler:** `npm start`, and open the project from the development app on the phone.

The `ios/` and `android/` folders are generated (`expo prebuild`) and never committed. Native changes go in
`app.config.ts`, a config plugin under `plugins/`, or a local module under `modules/`.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | The bundler, for the development build |
| `npm run lint` | ESLint and Prettier (`console.*` is an error: nothing sensitive may reach the log) |
| `npm run type-check` | TypeScript |
| `npm test` | Jest and React Native Testing Library |
| `npm run i18n:check` | Fails when the locale files differ from the web app's |
| `npm run i18n:copy` | Copies the web app's locale files here |

## Texts and colours come from the web app

- **Texts:** `src/i18n/locales/*.json` are copies of `frontend/src/i18n/*.json`. A new text is added to the web's
  `en.json` first (then `npm run i18n:sync` in `frontend/`), and copied here with `npm run i18n:copy`. The app never has a
  key the web does not.
- **Colours:** `src/theme/tokens.ts` copies `frontend/src/style.css`. A test fails when they differ.
- **Burmese and S'gaw Karen** use the bundled Noto Sans Myanmar (`assets/fonts`, SIL Open Font License) with taller
  lines. Use `AppText` (or `textStyleFor`) for text, so the font follows the language.

## Layout

```
app/                 screens (Expo Router: a file is a route)
  _layout.tsx        reads the saved session, then shows sign-in or the app
  login.tsx, register.tsx
  (app)/             everything behind sign-in: tabs, plus chats/[id], rooms/[id], calls/[id], settings
src/
  api/               the HTTP client and one module per API area
  stores/            Zustand stores (auth, chats, realtime)
  realtime/          the WebSocket (Echo): manager, background rules, event handlers
  hooks/             the heartbeat and the signed-in session
  components/        shared UI
  theme/             tokens, fonts, navigation styles
  i18n/              i18next and the locale files
  utils/             pure rules (dates, chat previews, avatar preparation), mostly ported from the web
  testing/           test helpers (fake API, fake Echo, factories, renderApp)
```
