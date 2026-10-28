// The voice message player arrives in 8C.4. Until then a voice message shows its length.
import { Mic } from 'lucide-react-native'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { AppText } from '@/components/common/AppText'
import type { TimelineMessage } from '@/types/chat'
import { colors, space } from '@/theme/tokens'
import { formatDuration } from '@/utils/dates'

export function VoicePlayer({
  message,
  own,
  style,
}: {
  message: TimelineMessage
  own: boolean
  style?: StyleProp<ViewStyle>
  onExpired(messageId: string): void
}) {
  const { t } = useTranslation()
  const duration = typeof message.metadata.duration_ms === 'number' ? message.metadata.duration_ms : null
  return (
    <View style={[styles.row, style]}>
      <Mic size={18} color={own ? colors.onPrimary : colors.primary} />
      <AppText color={own ? 'onPrimary' : 'text'}>
        {t('message.voiceMessage')}
        {duration !== null ? ` · ${formatDuration(duration)}` : ''}
      </AppText>
    </View>
  )
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: space[2] } })
