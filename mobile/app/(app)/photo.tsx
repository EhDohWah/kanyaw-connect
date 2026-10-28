// A photo from a chat, full screen: zoom in on it, save it to the phone's photos, or share it. Ported from
// frontend/src/components/chat/ImageViewer.vue, where "Download" became "Save to photos" and "Share".
import { useLocalSearchParams, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { Download, Share2, X } from 'lucide-react-native'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ZoomableImage } from '@/components/chat/ZoomableImage'
import { AppText } from '@/components/common/AppText'
import { useMessagesStore } from '@/stores/messages'
import { useToastStore } from '@/stores/toast'
import { space, TOUCH_TARGET } from '@/theme/tokens'
import { savePhoto, shareAttachment } from '@/utils/attachmentFiles'

const WHITE = '#FFFFFF'

export default function PhotoScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { chatId, messageId } = useLocalSearchParams<{ chatId: string; messageId: string }>()
  const message = useMessagesStore((state) =>
    state.timelines[chatId ?? '']?.messages.find((candidate) => candidate.id === messageId),
  )
  const [busy, setBusy] = useState<'save' | 'share' | null>(null)
  const toast = useToastStore((state) => state.show)

  const attachment = message?.type === 'image' ? message.attachment : null
  const label = message?.content || attachment?.original_name || t('chat.viewer.title')

  async function save(): Promise<void> {
    if (!message || busy) return
    setBusy('save')
    try {
      const result = await savePhoto(message)
      toast(
        result === 'saved' ? t('chat.viewer.saved') : t('chat.viewer.saveBlocked'),
        result === 'saved' ? 'success' : 'error',
      )
    } catch {
      toast(t('chat.viewer.saveFailed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  async function share(): Promise<void> {
    if (!message || busy) return
    setBusy('share')
    try {
      await shareAttachment(message)
    } catch {
      toast(t('message.openFailed'), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {attachment ? (
        <ZoomableImage
          uri={attachment.url}
          label={label}
          // Links last an hour: a full picture that will not load asks for fresh ones once.
          onError={() => message && void useMessagesStore.getState().refreshAttachment(message)}
        />
      ) : (
        <View style={styles.missing}>
          <AppText color="onPrimary">{t('message.photoUnavailable')}</AppText>
        </View>
      )}

      <View style={[styles.topBar, { paddingTop: insets.top + space[1] }]}>
        <BarButton label={t('common.close')} onPress={() => router.back()}>
          <X size={24} color={WHITE} />
        </BarButton>
        <View style={styles.spacer} />
        {attachment ? (
          <>
            <BarButton label={t('chat.viewer.share')} onPress={() => void share()} busy={busy === 'share'}>
              <Share2 size={22} color={WHITE} />
            </BarButton>
            <BarButton label={t('chat.viewer.save')} onPress={() => void save()} busy={busy === 'save'}>
              <Download size={22} color={WHITE} />
            </BarButton>
          </>
        ) : null}
      </View>

      {message?.content ? (
        <View style={[styles.caption, { paddingBottom: insets.bottom + space[3] }]}>
          <AppText color="onPrimary">{message.content}</AppText>
        </View>
      ) : null}
    </View>
  )
}

function BarButton({
  label,
  onPress,
  busy = false,
  children,
}: {
  label: string
  onPress: () => void
  busy?: boolean
  children: ReactNode
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy }}
      style={({ pressed }) => [styles.barButton, pressed && styles.pressed]}
    >
      {busy ? <ActivityIndicator color={WHITE} /> : children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[4] },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space[2],
    paddingBottom: space[1],
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  spacer: { flex: 1 },
  barButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: TOUCH_TARGET / 2,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.15)' },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space[4],
    paddingTop: space[3],
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
})
