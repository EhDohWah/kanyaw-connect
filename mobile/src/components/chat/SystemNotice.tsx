import { useRouter } from 'expo-router'
import { ArrowDownLeft, ArrowUpRight, Phone, Video } from 'lucide-react-native'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { Button } from '@/components/common/Button'
import type { Chat, TimelineMessage } from '@/types/chat'
import { colors, space } from '@/theme/tokens'
import { callNotice, personById, systemText } from '@/utils/chatText'

/**
 * A line written by the server ("Naw Paw started a video meeting", "Missed voice call"): centred, not a bubble.
 * Calling back from here arrives with calls on the phone (8E).
 */
export const SystemNotice = memo(function SystemNotice({
  message,
  chat,
  meId,
}: {
  message: TimelineMessage
  chat: Chat
  meId: string
}) {
  const { t } = useTranslation()
  const router = useRouter()

  const text = systemText(
    message,
    t,
    (userId) => (userId === meId ? t('common.you') : personById(chat, userId)?.name),
    meId,
  )
  const call = callNotice(message, meId)
  const roomId =
    message.metadata.event === 'room_created' && typeof message.metadata.room_id === 'string'
      ? message.metadata.room_id
      : null

  const CallIcon = call?.kind === 'video' ? Video : Phone
  const Arrow = call?.incoming ? ArrowDownLeft : ArrowUpRight
  const tint = call?.missedByYou ? colors.danger : colors.textMuted

  return (
    <View style={styles.wrap}>
      {call ? (
        <View
          style={styles.callLine}
          accessible
          accessibilityLabel={`${call.incoming ? t('chat.system.call.incoming') : t('chat.system.call.outgoing')}: ${text}`}
        >
          <CallIcon size={16} color={tint} />
          <Arrow size={14} color={tint} />
          <AppText size="sm" color={call.missedByYou ? 'danger' : 'textMuted'}>
            {text}
          </AppText>
        </View>
      ) : (
        <AppText size="sm" color="textMuted" style={styles.center}>
          {text}
        </AppText>
      )}
      {roomId ? (
        <Button
          label={t('chat.system.joinMeeting')}
          variant="secondary"
          icon={<Video size={16} color={colors.primary} />}
          onPress={() => router.push(`/rooms/${roomId}`)}
        />
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[2], marginVertical: space[3], paddingHorizontal: space[4] },
  callLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  center: { textAlign: 'center' },
})
