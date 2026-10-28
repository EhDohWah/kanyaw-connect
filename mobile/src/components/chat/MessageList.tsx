// Ported from frontend/src/components/chat/MessageList.vue. On the phone it is an inverted FlatList: the newest message
// is at the bottom, the list opens there, and scrolling up (its "end") loads older pages.
import { ArrowDown, MessageCircle } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'

import type { ApiError } from '@/api/errors'
import { MessageRow, type MessageRowHandlers } from '@/components/chat/MessageRow'
import { SystemNotice } from '@/components/chat/SystemNotice'
import { AppText } from '@/components/common/AppText'
import { Button } from '@/components/common/Button'
import { StateMessage } from '@/components/common/StateMessage'
import { useMinute } from '@/hooks/useMinute'
import type { Chat, TimelineMessage } from '@/types/chat'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import { formatDayLabel } from '@/utils/dates'
import { buildTimeline, type TimelineItem } from '@/utils/timeline'

/** How close to the newest message (in points) still counts as "at the bottom". */
export const NEAR_BOTTOM = 80

export interface MessageListHandle {
  scrollToBottom(): void
}

export interface MessageListProps extends MessageRowHandlers {
  chat: Chat
  messages: TimelineMessage[]
  meId: string
  timeZone: string
  locale: string
  hasOlder: boolean
  loadingOlder: boolean
  olderError: ApiError | null
  onLoadOlder(): void
  onAtBottom(atBottom: boolean): void
  listRef?: (handle: MessageListHandle | null) => void
}

export function MessageList({
  chat,
  messages,
  meId,
  timeZone,
  locale,
  hasOlder,
  loadingOlder,
  olderError,
  onLoadOlder,
  onAtBottom,
  listRef,
  ...rowHandlers
}: MessageListProps) {
  const { t } = useTranslation()
  const list = useRef<FlatList<TimelineItem>>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [unseen, setUnseen] = useState(0)

  // Newest first, because the list is inverted.
  const items = useMemo(() => buildTimeline(messages, { meId, timeZone }).reverse(), [messages, meId, timeZone])

  const scrollToBottom = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: true })
    setUnseen(0)
  }, [])

  useEffect(() => {
    listRef?.({ scrollToBottom })
    return () => listRef?.(null)
  }, [listRef, scrollToBottom])

  // Something new while scrolled up counts as unseen; anything while at the bottom does not. (Adjusted while rendering,
  // React's pattern for state that follows a prop.)
  const newest = messages[messages.length - 1]
  const newestKey = newest ? (newest.client_id ?? newest.id) : null
  const [countedNewest, setCountedNewest] = useState(newestKey)
  if (newestKey !== countedNewest) {
    setCountedNewest(newestKey)
    if (newest && !atBottom && newest.sender_id !== meId) setUnseen(unseen + 1)
  }

  // Your own new message while scrolled up: go down to it.
  const ownNewest = newest?.sender_id === meId ? newestKey : null
  useEffect(() => {
    if (ownNewest) list.current?.scrollToOffset({ offset: 0, animated: true })
  }, [ownNewest])

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const near = event.nativeEvent.contentOffset.y < NEAR_BOTTOM
      if (near !== atBottom) {
        setAtBottom(near)
        onAtBottom(near)
      }
      if (near) setUnseen(0)
    },
    [atBottom, onAtBottom],
  )

  const now = useMinute()
  const renderItem = useCallback(
    ({ item }: { item: TimelineItem }) => {
      if (item.kind === 'day') {
        return (
          <AppText size="xs" weight={500} color="textMuted" style={styles.day} accessibilityRole="header">
            {formatDayLabel(item.iso, now, timeZone, locale, {
              today: t('chat.conversation.today'),
              yesterday: t('chat.conversation.yesterday'),
            })}
          </AppText>
        )
      }
      if (item.kind === 'system') return <SystemNotice message={item.message} chat={chat} meId={meId} />
      return <MessageRow item={item} chat={chat} meId={meId} timeZone={timeZone} locale={locale} {...rowHandlers} />
    },
    // The handlers come from the screen's stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chat, meId, timeZone, locale, t, now],
  )

  if (messages.length === 0 && !hasOlder) {
    return (
      <StateMessage
        icon={<MessageCircle size={40} color={colors.textMuted} />}
        title={t('chat.conversation.emptyTitle')}
        text={t('chat.conversation.emptyText')}
      />
    )
  }

  return (
    <View style={styles.fill}>
      <FlatList
        ref={list}
        inverted
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        accessibilityLabel={t('chat.conversation.messages')}
        onScroll={onScroll}
        scrollEventThrottle={64}
        onEndReached={() => {
          if (hasOlder && !loadingOlder && !olderError) onLoadOlder()
        }}
        onEndReachedThreshold={0.4}
        // Keeps what you are reading in place when a new message arrives while you are scrolled up.
        maintainVisibleContentPosition={{ minIndexForVisible: 1, autoscrollToTopThreshold: NEAR_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        initialNumToRender={20}
        windowSize={11}
        removeClippedSubviews
        contentContainerStyle={styles.content}
        // Inverted: the "footer" is at the top, above the oldest message.
        ListFooterComponent={
          hasOlder || olderError ? (
            <View style={styles.older}>
              {olderError ? (
                <>
                  <AppText size="sm" color="danger" accessibilityRole="alert">
                    {t('chat.conversation.olderError')}
                  </AppText>
                  <Button label={t('common.retry')} variant="secondary" onPress={onLoadOlder} />
                </>
              ) : (
                <ActivityIndicator color={colors.primary} accessibilityLabel={t('chat.conversation.loadingOlder')} />
              )}
            </View>
          ) : undefined
        }
      />

      {!atBottom ? (
        <Pressable
          onPress={scrollToBottom}
          accessibilityRole="button"
          style={({ pressed }) => [styles.jump, pressed && styles.jumpPressed]}
        >
          <ArrowDown size={16} color={colors.text} />
          <AppText size="sm" weight={500}>
            {unseen > 0 ? t('chat.conversation.newMessages', { count: unseen }) : t('chat.conversation.jumpToLatest')}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingVertical: space[3] },
  day: { textAlign: 'center', marginVertical: space[3] },
  older: { alignItems: 'center', gap: space[2], paddingVertical: space[3] },
  jump: {
    position: 'absolute',
    right: space[3],
    bottom: space[3],
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  jumpPressed: { backgroundColor: colors.surface },
})
