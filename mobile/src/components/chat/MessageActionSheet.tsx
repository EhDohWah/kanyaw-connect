import { useTranslation } from 'react-i18next'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AppText } from '@/components/common/AppText'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import type { MessageAction, MessageActionKey } from '@/utils/messageActions'

/** What a long press on a message opens: its actions as large rows, and Cancel. */
export function MessageActionSheet({
  actions,
  onRun,
  onClose,
}: {
  /** null: closed. */
  actions: MessageAction[] | null
  onRun: (key: MessageActionKey) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible={actions !== null} transparent animationType="fade" onRequestClose={onClose}>
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
          {t('message.actions')}
        </AppText>
        {(actions ?? []).map((action) => {
          const Icon = action.icon
          return (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              onPress={() => onRun(action.key)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Icon size={20} color={action.danger ? colors.danger : colors.text} />
              <AppText color={action.danger ? 'danger' : 'text'} weight={500}>
                {t(action.label)}
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
