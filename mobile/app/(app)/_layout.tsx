import { Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'

import { OfflineBanner } from '@/components/common/OfflineBanner'
import { StateMessage } from '@/components/common/StateMessage'
import { Toast } from '@/components/common/Toast'
import { useAppSession } from '@/hooks/useAppSession'
import { useAuthStore } from '@/stores/auth'
import { isOfflineShown, useRealtimeStore } from '@/stores/realtime'
import { colors } from '@/theme/tokens'
import { headerOptions } from '@/theme/navigation'
import { errorMessage } from '@/utils/errorMessage'

export const unstable_settings = { anchor: '(tabs)' }

/** Everything behind sign-in: the tabs, and the screens that open over them (a conversation, a meeting, a call). */
export default function SignedInLayout() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const bootError = useAuthStore((state) => state.bootError)
  const insets = useSafeAreaInsets()
  const bannerShown = useRealtimeStore(isOfflineShown)
  useAppSession()

  // The saved session is being checked, or could not be (no connection): the token is kept, so offer to try again.
  if (!user) {
    return (
      <View style={styles.fill}>
        {bootError ? (
          <StateMessage
            title={t('errors.pageLoad')}
            text={errorMessage(bootError, t)}
            action={{ label: t('common.retry'), onPress: () => void useAuthStore.getState().loadUser() }}
          />
        ) : (
          <ActivityIndicator style={styles.fill} color={colors.primary} accessibilityLabel={t('common.loading')} />
        )}
      </View>
    )
  }

  return (
    <View style={styles.fill}>
      <OfflineBanner />
      {/* The banner already keeps clear of the notch; the screens below it should not add the space again. */}
      <SafeAreaInsetsContext.Provider value={bannerShown ? { ...insets, top: 0 } : insets}>
        <Stack screenOptions={{ ...headerOptions(i18n.language), headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="chats/[id]" options={{ title: t('placeholders.chatTitle') }} />
          <Stack.Screen name="chats/info/[id]" options={{ title: t('chat.conversation.info') }} />
          <Stack.Screen
            name="photo"
            options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade' }}
          />
          <Stack.Screen name="rooms/[id]" options={{ title: t('placeholders.roomTitle') }} />
          <Stack.Screen name="calls/[id]" options={{ title: t('placeholders.callTitle') }} />
          <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
        </Stack>
      </SafeAreaInsetsContext.Provider>
      <Toast />
    </View>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' } })
