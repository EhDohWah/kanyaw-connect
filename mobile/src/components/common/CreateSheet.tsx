import { ImagePlus, Video } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppText } from '@/components/common/AppText'
import { Button } from '@/components/common/Button'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'

/**
 * What the Create tab opens: a sheet from the bottom with the things you can start. Posting waits for the real feed
 * and starting a meeting arrives with the meeting screens (8D), so both say "Coming soon" for now.
 */
export function CreateSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + space[4] }]} accessibilityViewIsModal>
          <AppText size="lg" weight={600} accessibilityRole="header">
            {t('create.title')}
          </AppText>
          <Option
            icon={<ImagePlus size={24} color={colors.textMuted} />}
            title={t('create.post')}
            hint={t('create.postHint')}
          />
          <Option
            icon={<Video size={24} color={colors.textMuted} />}
            title={t('create.meeting')}
            hint={t('create.meetingHint')}
          />
          <Button label={t('common.close')} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}

function Option({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  const { t } = useTranslation()
  return (
    <View
      style={styles.option}
      accessibilityState={{ disabled: true }}
      accessible
      accessibilityLabel={`${title}. ${hint}. ${t('common.comingSoon')}`}
    >
      {icon}
      <View style={styles.optionText}>
        <AppText weight={600} color="textMuted">
          {title}
        </AppText>
        <AppText size="sm" color="textMuted">
          {hint} · {t('common.comingSoon')}
        </AppText>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(24, 24, 27, 0.4)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: space[4],
    gap: space[3],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: TOUCH_TARGET,
    padding: space[3],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  optionText: { flex: 1, gap: space[1] },
})
