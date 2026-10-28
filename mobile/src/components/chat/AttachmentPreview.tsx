// What is about to be sent, above the message box: a small picture or a file card, with a way to take it back.
import { Image } from 'expo-image'
import { FileText, X } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import type { LocalFile } from '@/types/chat'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import { formatBytes, messageTypeForFile } from '@/utils/files'

export function AttachmentPreview({ file, onRemove }: { file: LocalFile; onRemove: () => void }) {
  const { t } = useTranslation()
  const isImage = messageTypeForFile(file) === 'image'

  return (
    <View style={styles.card}>
      {isImage ? (
        <Image source={file.uri} style={styles.thumb} contentFit="cover" accessible={false} />
      ) : (
        <View style={[styles.thumb, styles.fileIcon]}>
          <FileText size={24} color={colors.primary} />
        </View>
      )}
      <View style={styles.text}>
        <AppText size="sm" weight={500} numberOfLines={1}>
          {isImage ? t('chat.preview.photo') : file.name}
        </AppText>
        {file.size !== null ? (
          <AppText size="xs" color="textMuted">
            {formatBytes(file.size)}
          </AppText>
        ) : null}
      </View>
      <Pressable
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={t('chat.composer.removeAttachment')}
        style={styles.remove}
      >
        <X size={18} color={colors.text} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginBottom: space[2],
    padding: space[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumb: { width: 56, height: 56, borderRadius: radius.md, backgroundColor: colors.border },
  fileIcon: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  text: { flex: 1, minWidth: 0, gap: 2 },
  remove: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
})
