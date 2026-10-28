import '@/i18n'

import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'

import { useAuthStore } from '@/stores/auth'

// The splash screen stays up while the saved token is read from secure storage, so no screen flashes past.
void SplashScreen.preventAutoHideAsync().catch(() => undefined)

export default function RootLayout() {
  const status = useAuthStore((state) => state.status)

  useEffect(() => {
    void useAuthStore.getState().restore()
  }, [])

  useEffect(() => {
    if (status !== 'restoring') void SplashScreen.hideAsync().catch(() => undefined)
  }, [status])

  // Nothing is drawn under the splash screen until the saved session is known, so a link that opened the app
  // (kanyawconnect://chats/…) is still the address when the signed-in screens appear.
  if (status === 'restoring') return null
  const signedIn = status === 'signedIn'

  // The gesture root (pinch-to-zoom in the photo viewer) wraps everything once, at the top.
  return (
    <GestureHandlerRootView style={styles.root}>
      <StatusBar style="dark" />
      {/* Signed out, only sign-in and create-account exist; signed in, only the app. Signing in or out moves to the
          other side (sign-in is the first screen, so it is where a signed-out person lands) and clears the history. */}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({ root: { flex: 1 } })
