import { existsSync } from 'node:fs'

import type { ConfigContext, ExpoConfig } from 'expo/config'

/**
 * The app's identity on both stores. A placeholder until the real identifier is chosen: change it here only. The
 * VoIP push topic (8B) and every native setting derive from it.
 */
export const BUNDLE_ID = 'org.example.kanyawconnect'

/**
 * Firebase's file for the Android app (Firebase console > Project settings > Your apps). It holds no secret, but it
 * names the Firebase project, so it is kept out of git: put it next to this file, or point GOOGLE_SERVICES_JSON at it
 * (an EAS "file" environment variable for cloud builds). Without it the app builds, but cannot get a push token.
 */
const GOOGLE_SERVICES_JSON =
  process.env.GOOGLE_SERVICES_JSON ?? (existsSync('./google-services.json') ? './google-services.json' : undefined)

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Kanyaw Connect',
  slug: 'kanyaw-connect',
  version: '0.1.0',
  scheme: 'kanyawconnect',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    infoPlist: {
      // Asked only when the person picks a photo or takes one for their avatar (permission at the point of use).
      NSPhotoLibraryUsageDescription: 'Kanyaw Connect uses your photos when you choose a profile picture.',
      NSCameraUsageDescription: 'Kanyaw Connect uses the camera for video calls and for taking a profile picture.',
      NSMicrophoneUsageDescription: 'Kanyaw Connect uses the microphone for calls and voice messages.',
    },
  },
  android: {
    package: BUNDLE_ID,
    googleServicesFile: GOOGLE_SERVICES_JSON,
    adaptiveIcon: {
      backgroundColor: '#1D4E89',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // "Display over other apps": the WebRTC plugin asks for it, nothing here needs it (incoming calls use a
    // full-screen notification, 8E), and Google Play reviews it closely. Debug builds keep it from React Native's
    // own debug manifest, which takes priority, for the developer menu.
    blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'],
  },
  plugins: [
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#1D4E89', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-secure-store',
    // Push notifications. The server sends message notifications on the `messages` channel (see push/phonePush).
    ['expo-notifications', { color: '#1D4E89', defaultChannel: 'messages' }],
    'expo-localization',
    [
      'expo-image-picker',
      {
        photosPermission: 'Kanyaw Connect uses your photos when you choose a profile picture.',
        cameraPermission: 'Kanyaw Connect uses the camera for video calls and for taking a profile picture.',
        // Not `false`: that removes RECORD_AUDIO from the whole app (the plugin blocks the permission), and calls
        // and voice messages need it. The picker itself never records.
        microphonePermission: 'Kanyaw Connect uses the microphone for calls and voice messages.',
      },
    ],
    [
      'expo-font',
      {
        // Bundled so Burmese and S'gaw Karen never depend on a download. Android 16 ignores `elegantTextHeight` for
        // apps that target it, so the system font cannot be relied on for Myanmar script.
        android: {
          fonts: [
            {
              fontFamily: 'NotoSansMyanmar',
              fontDefinitions: [
                { path: './assets/fonts/NotoSansMyanmar_400Regular.ttf', weight: 400 },
                { path: './assets/fonts/NotoSansMyanmar_500Medium.ttf', weight: 500 },
                { path: './assets/fonts/NotoSansMyanmar_600SemiBold.ttf', weight: 600 },
                { path: './assets/fonts/NotoSansMyanmar_700Bold.ttf', weight: 700 },
              ],
            },
          ],
        },
        ios: {
          fonts: [
            './assets/fonts/NotoSansMyanmar_400Regular.ttf',
            './assets/fonts/NotoSansMyanmar_500Medium.ttf',
            './assets/fonts/NotoSansMyanmar_600SemiBold.ttf',
            './assets/fonts/NotoSansMyanmar_700Bold.ttf',
          ],
        },
      },
    ],
    // Adds LiveKit's CocoaPods source (https://github.com/livekit/podspecs.git) above the CDN at prebuild.
    ['@livekit/react-native-expo-plugin', { android: { audioType: 'communication' } }],
    '@config-plugins/react-native-webrtc',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    bundleId: BUNDLE_ID,
  },
})
