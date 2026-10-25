import { BellOff, Lock, Pin } from 'lucide-react-native'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { Avatar } from '@/components/common/Avatar'
import type { Chat } from '@/types/chat'
import { colors, radius, space } from '@/theme/tokens'
import { chatAvatar, chatTitle, messagePreview } from '@/utils/chatText'
import { formatListTime } from '@/utils/dates'

export interface ChatRowProps {
  chat: Chat
  meId: string
  timeZone: string
  now: number
  onPress: (chatId: string) => void
}

/** One chat in the list. Ported from frontend/src/components/chat/ChatListRow.vue (presence dots come with 8C). */
export const ChatRow = memo(function ChatRow({ chat, meId, timeZone, now, onPress }: ChatRowProps) {
  const { t, i18n } = useTranslation()
  const title = chatTitle(chat, t('chat.untitled'))
  const avatar = chatAvatar(chat, t('chat.untitled'))
  const preview = messagePreview(chat, meId, (key, named) => t(key, named ?? {}))
  const unread = chat.unread_count
  const muted = chat.my_membership.is_muted
  const pinned = chat.my_membership.pin_position !== null
  const at = chat.latest_message?.created_at ?? chat.last_message_at
  const time = at
    ? formatListTime(at, now, timeZone, i18n.language, {
        today: t('chat.conversation.today'),
        yesterday: t('chat.conversation.yesterday'),
      })
    : ''

  // Read out as one sentence: name, the state icons, time, unread count, last message.
  const label = [
    title,
    pinned ? t('chat.pinned') : '',
    muted ? t('chat.muted') : '',
    time,
    unread > 0 ? t('chat.unreadCount', { count: unread }) : '',
    preview,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPress(chat.id)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface }]}
    >
      <Avatar name={avatar.name} seed={avatar.seed} src={avatar.src} />
      <View style={styles.body}>
        <View style={styles.line}>
          <AppText weight={unread > 0 ? 600 : 500} numberOfLines={1} style={styles.grow}>
            {title}
          </AppText>
          <View style={styles.meta}>
            {pinned ? <Pin size={14} color={colors.textMuted} /> : null}
            {muted ? <BellOff size={14} color={colors.textMuted} /> : null}
            <AppText size="xs" color="textMuted">
              {time}
            </AppText>
          </View>
        </View>
        <View style={styles.line}>
          {chat.is_encrypted ? <Lock size={14} color={colors.textMuted} /> : null}
          <AppText size="sm" color={unread > 0 ? 'text' : 'textMuted'} numberOfLines={1} style={styles.grow}>
            {preview}
          </AppText>
          {unread > 0 ? (
            <View style={[styles.badge, { backgroundColor: muted ? colors.textMuted : colors.primary }]}>
              <AppText size="xs" weight={600} color="onPrimary" maxFontSizeMultiplier={1.5}>
                {unread > 99 ? '99+' : String(unread)}
              </AppText>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    minHeight: 72,
  },
  body: { flex: 1, gap: space[1] },
  line: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  grow: { flex: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  badge: {
    minWidth: 20,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
