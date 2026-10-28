// Ported from frontend/src/components/chat/MessageRow.vue, rebuilt for touch: a long press opens the actions (the web
// shows them beside the bubble on hover), and screen readers reach the same actions on the message itself.
import { AlertTriangle } from 'lucide-react-native'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native'

import { LinkifiedText } from '@/components/chat/LinkifiedText'
import { MessageMedia } from '@/components/chat/MessageMedia'
import { ReplyQuote } from '@/components/chat/ReplyQuote'
import { AppText } from '@/components/common/AppText'
import { Avatar } from '@/components/common/Avatar'
import type { Chat } from '@/types/chat'
import { colors, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import { personById } from '@/utils/chatText'
import { formatClock } from '@/utils/dates'
import { errorMessage } from '@/utils/errorMessage'
import { availableActions, type MessageActionKey } from '@/utils/messageActions'
import type { TimelineItem } from '@/utils/timeline'

type MessageItem = Extract<TimelineItem, { kind: 'message' }>

export interface MessageRowHandlers {
  /** A long press: open the action sheet for this message. */
  onOpenActions(messageId: string): void
  /** An action chosen straight from a screen reader. */
  onAction(key: MessageActionKey, messageId: string): void
  onRetry(clientId: string): void
  onDiscard(clientId: string): void
  onOpenImage(messageId: string): void
  onOpenFile(messageId: string): void
  /** An attachment link stopped working: ask for fresh ones. */
  onExpired(messageId: string): void
}

export interface MessageRowProps extends MessageRowHandlers {
  item: MessageItem
  chat: Chat
  meId: string
  timeZone: string
  locale: string
}

export const MessageRow = memo(function MessageRow({
  item,
  chat,
  meId,
  timeZone,
  locale,
  ...handlers
}: MessageRowProps) {
  const { t } = useTranslation()
  const { message, own } = item
  const pending = message.pending

  const senderName = message.sender?.name ?? t('chat.someone')
  const showName = !own && chat.type === 'group' && item.firstInGroup
  const time = formatClock(message.created_at, timeZone, locale)
  const actions = useMemo(() => availableActions(message, chat, meId), [message, chat, meId])

  const replyName = (() => {
    const reply = message.reply_to
    if (!reply) return ''
    if (reply.sender_id === meId) return t('common.you')
    return (reply.sender_id ? personById(chat, reply.sender_id)?.name : undefined) ?? t('chat.someone')
  })()

  // One sentence for screen readers: who, what, when; the actions are offered on the same element.
  const mediaLabel: Record<string, string> = {
    image: t('chat.preview.photo'),
    voice: t('message.voiceMessage'),
    file: message.attachment?.original_name ?? t('chat.preview.file'),
  }
  const spoken = [
    own ? t('common.you') : senderName,
    message.reply_to ? t('message.replyTo', { name: replyName }) : null,
    mediaLabel[message.type] ?? null,
    message.content,
    pending?.status === 'sending' ? t('message.sending') : pending?.status === 'failed' ? t('message.failed') : time,
    message.is_edited ? t('message.edited') : null,
  ]
    .filter(Boolean)
    .join(', ')

  const accessibilityActions = actions.map((action) => ({ name: action.key, label: t(action.label) }))
  const onAccessibilityAction = (event: AccessibilityActionEvent): void =>
    handlers.onAction(event.nativeEvent.actionName as MessageActionKey, message.id)

  return (
    <View style={[styles.row, own && styles.rowOwn, item.lastInGroup ? styles.endOfRun : styles.inRun]}>
      {!own ? (
        <View style={styles.avatarSlot}>
          {item.lastInGroup ? (
            <Avatar
              name={senderName}
              seed={message.sender_id ?? senderName}
              src={message.sender?.avatar_thumb_url}
              size="sm"
            />
          ) : null}
        </View>
      ) : null}

      <View style={[styles.column, own ? styles.columnOwn : styles.columnOther]}>
        {showName ? (
          <AppText size="xs" weight={500} color="textMuted" style={styles.name}>
            {senderName}
          </AppText>
        ) : null}

        <Pressable
          onLongPress={actions.length > 0 ? () => handlers.onOpenActions(message.id) : undefined}
          delayLongPress={350}
          accessible
          accessibilityLabel={spoken}
          accessibilityHint={actions.length > 0 ? t('message.actions') : undefined}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          style={[
            styles.bubble,
            own ? styles.bubbleOwn : styles.bubbleOther,
            pending?.status === 'sending' && styles.sending,
            pending?.status === 'failed' && styles.failed,
          ]}
        >
          {message.reply_to ? <ReplyQuote reply={message.reply_to} senderName={replyName} own={own} /> : null}
          {message.attachment ? (
            <MessageMedia
              message={message}
              own={own}
              progress={pending?.status === 'sending' ? pending.progress : null}
              onOpenImage={handlers.onOpenImage}
              onOpenFile={handlers.onOpenFile}
              onExpired={handlers.onExpired}
              style={message.content ? styles.mediaWithText : undefined}
            />
          ) : null}
          {message.content ? <LinkifiedText text={message.content} own={own} /> : null}
        </Pressable>

        {pending?.status === 'sending' ? (
          <View style={styles.status}>
            <ActivityIndicator size="small" color={colors.textMuted} />
            <AppText size="xs" color="textMuted">
              {pending.progress !== null && pending.progress < 100
                ? t('message.uploading', { percent: pending.progress })
                : t('message.sending')}
            </AppText>
          </View>
        ) : pending?.status === 'failed' ? (
          <View style={[styles.failure, own ? styles.columnOwn : styles.columnOther]}>
            <View style={styles.status} accessibilityRole="alert">
              <AlertTriangle size={14} color={colors.danger} />
              <AppText size="xs" color="danger" style={styles.shrink}>
                {t('message.failed')}
                {pending.error ? `: ${errorMessage(pending.error, t)}` : ''}
              </AppText>
            </View>
            <View style={styles.failureButtons}>
              <Pressable
                accessibilityRole="button"
                onPress={() => handlers.onRetry(pending.clientId)}
                style={styles.textButton}
              >
                <AppText size="sm" weight={600} color="primary">
                  {t('message.retry')}
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => handlers.onDiscard(pending.clientId)}
                style={styles.textButton}
              >
                <AppText size="sm" weight={600}>
                  {t('message.discard')}
                </AppText>
              </Pressable>
            </View>
          </View>
        ) : item.lastInGroup ? (
          <AppText size="xs" color="textMuted" style={styles.time} importantForAccessibility="no">
            {time}
            {message.is_edited ? ` · ${t('message.edited')}` : ''}
          </AppText>
        ) : null}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space[2], paddingHorizontal: space[3] },
  rowOwn: { flexDirection: 'row-reverse' },
  inRun: { marginBottom: 2 },
  endOfRun: { marginBottom: space[3] },
  avatarSlot: { width: 32, justifyContent: 'flex-end' },
  column: { maxWidth: '78%', minWidth: 0 },
  columnOwn: { alignItems: 'flex-end' },
  columnOther: { alignItems: 'flex-start' },
  name: { marginBottom: 2, paddingHorizontal: space[1] },
  bubble: { borderRadius: radius.xl, paddingHorizontal: space[3], paddingVertical: space[2], minWidth: 0 },
  bubbleOwn: { backgroundColor: colors.primary },
  bubbleOther: { backgroundColor: colors.surface },
  sending: { opacity: 0.7 },
  failed: { borderWidth: 2, borderColor: colors.danger },
  mediaWithText: { marginBottom: space[2] },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: space[1], paddingHorizontal: space[1] },
  shrink: { flexShrink: 1 },
  failure: { marginTop: 2 },
  failureButtons: { flexDirection: 'row', gap: space[3] },
  textButton: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: space[1] },
  time: { marginTop: space[1], paddingHorizontal: space[1] },
})
