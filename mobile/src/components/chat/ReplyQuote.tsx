import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import type { ReplyPreview } from '@/types/chat'
import { colors, radius, space } from '@/theme/tokens'

/** The quoted message above a reply: who wrote it and its first words ("This message was deleted" if it is gone). */
export function ReplyQuote({ reply, senderName, own }: { reply: ReplyPreview; senderName: string; own: boolean }) {
  const { t } = useTranslation()
  const media: Record<string, string> = {
    image: t('chat.preview.photo'),
    voice: t('chat.preview.voice'),
    file: t('chat.preview.file'),
  }
  const text = reply.is_deleted ? t('message.deletedOriginal') : (reply.content ?? media[reply.type] ?? '')

  return (
    <View style={[styles.quote, own ? styles.own : styles.other]}>
      <AppText size="xs" weight={600} color={own ? 'onPrimary' : 'primary'} numberOfLines={1}>
        {senderName}
      </AppText>
      <AppText
        size="sm"
        color={own ? 'onPrimary' : 'text'}
        numberOfLines={2}
        style={reply.is_deleted ? styles.deleted : undefined}
      >
        {text}
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({
  quote: {
    borderLeftWidth: 4,
    borderRadius: radius.md,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    marginBottom: 6,
  },
  own: { borderLeftColor: colors.onPrimary, backgroundColor: colors.primaryHover },
  other: { borderLeftColor: colors.primary, backgroundColor: colors.bg },
  deleted: { fontStyle: 'italic' },
})
