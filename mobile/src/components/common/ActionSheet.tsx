import type { LucideIcon } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppText } from '@/components/common/AppText'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'

export interface SheetItem<Key extends string> {
  key: Key
  /** Already translated. */
  label: string
  icon: LucideIcon
  danger?: boolean
}

/**
 * A sheet of large rows from the bottom of the screen, and Cancel: the actions of a message (a long press), the ways
 * to attach something. `onDismiss` runs once the sheet has gone (iOS only, as React Native's Modal): a system screen
 * such as the photo picker can only open after that.
 */
export function ActionSheet<Key extends string>({
  title,
  items,
  onRun,
  onClose,
  onDismiss,
}: {
  title: string
  /** null: closed. */
  items: SheetItem<Key>[] | null
  onRun: (key: Key) => void
  onClose: () => void
  onDismiss?: () => void
}) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={items !== null} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismiss}>
      <Pressable
        style={styles.backdrop}
        onPress={onClose}
        accessibilityLabel={t('common.close')}
        accessibilityRole="button"
      >
        <View />
      </Pressable>
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space[2] }]} accessibilityViewIsModal>
        <AppText size="sm" weight={600} color="textMuted" style={styles.title} accessibilityRole="header">
          {title}
        </AppText>
        {(items ?? []).map((item) => {
          const Icon = item.icon
          return (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              onPress={() => onRun(item.key)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Icon size={20} color={item.danger ? colors.danger : colors.text} />
              <AppText color={item.danger ? 'danger' : 'text'} weight={500}>
                {item.label}
              </AppText>
            </Pressable>
          )
        })}
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.row, styles.cancel, pressed && styles.pressed]}
        >
          <AppText weight={500}>{t('common.cancel')}</AppText>
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: space[3],
    paddingHorizontal: space[2],
  },
  title: { paddingHorizontal: space[3], paddingBottom: space[2] },
  row: {
    minHeight: TOUCH_TARGET + 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
  },
  cancel: {
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: space[1],
  },
  pressed: { backgroundColor: colors.surface },
})
