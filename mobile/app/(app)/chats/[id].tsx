// Ported from frontend/src/components/chat/Conversation.vue and ConversationHeader.vue, as one phone screen.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { Info, Lock, MessageCircleOff } from 'lucide-react-native'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { Composer } from '@/components/chat/Composer'
import { MessageActionSheet } from '@/components/chat/MessageActionSheet'
import { MessageList, type MessageListHandle } from '@/components/chat/MessageList'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import { AppText } from '@/components/common/AppText'
import { Avatar } from '@/components/common/Avatar'
import { StateMessage } from '@/components/common/StateMessage'
import { useConversation } from '@/hooks/useConversation'
import { useAuthStore } from '@/stores/auth'
import { useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'
import { useToastStore } from '@/stores/toast'
import { useTypingStore } from '@/stores/typing'
import type { TimelineMessage } from '@/types/chat'
import { colors, space, TOUCH_TARGET } from '@/theme/tokens'
import { chatAvatar, chatTitle, personById } from '@/utils/chatText'
import { errorMessage } from '@/utils/errorMessage'
import { availableActions, copyText, type MessageActionKey } from '@/utils/messageActions'

const NO_ONE: string[] = []

export default function ConversationScreen() {
  const { t, i18n } = useTranslation()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const chatId = id ?? ''
  const headerHeight = useHeaderHeight()
  const user = useAuthStore((state) => state.user)

  const { chat, timeline, state, setAtBottom, reload, meId } = useConversation(chatId)
  const typingIds = useTypingStore((state) => state.byChat[chatId] ?? NO_ONE)
  const listHandle = useRef<MessageListHandle | null>(null)
  const [sheetFor, setSheetFor] = useState<string | null>(null)

  const find = useCallback(
    (messageId: string): TimelineMessage | undefined =>
      useMessagesStore
        .getState()
        .timeline(chatId)
        ?.messages.find((message) => message.id === messageId),
    [chatId],
  )

  const typingNames = useMemo(
    () =>
      chat
        ? typingIds.map((userId) => personById(chat, userId)?.name).filter((name): name is string => name !== undefined)
        : [],
    [chat, typingIds],
  )

  const confirmDelete = useCallback(
    (message: TimelineMessage) => {
      Alert.alert(t('chat.delete.title'), t('chat.delete.text'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('message.delete'),
          style: 'destructive',
          onPress: () => {
            useMessagesStore
              .getState()
              .remove(message)
              .then(() => {
                const drafts = useDraftsStore.getState()
                if (drafts.get(chatId).replyToId === message.id) drafts.update(chatId, { replyToId: null })
              })
              .catch((error: unknown) =>
                Alert.alert(t('chat.delete.failed'), isApiError(error) ? errorMessage(error, t) : undefined),
              )
          },
        },
      ])
    },
    [chatId, t],
  )

  const runAction = useCallback(
    (key: MessageActionKey, messageId: string) => {
      setSheetFor(null)
      const message = find(messageId)
      if (!message) return
      const drafts = useDraftsStore.getState()

      if (key === 'reply') drafts.update(chatId, { editingId: null, replyToId: message.id })
      else if (key === 'edit') drafts.update(chatId, { replyToId: null, editingId: message.id })
      else if (key === 'copy')
        void copyText(message.content ?? '').then((copied) =>
          useToastStore
            .getState()
            .show(copied ? t('message.copied') : t('message.copyFailed'), copied ? 'success' : 'error'),
        )
      else confirmDelete(message)
    },
    [chatId, confirmDelete, find, t],
  )

  const sheetMessage = sheetFor ? find(sheetFor) : undefined
  const sheetActions = sheetMessage && chat ? availableActions(sheetMessage, chat, meId) : null

  // Stable handlers, so message rows only redraw when their own message changes.
  const handlers = useMemo(
    () => ({
      onOpenActions: (messageId: string) => setSheetFor(messageId),
      onAction: runAction,
      onRetry: (clientId: string) => void useMessagesStore.getState().retry(chatId, clientId),
      onDiscard: (clientId: string) => useMessagesStore.getState().discard(chatId, clientId),
      onOpenImage: (messageId: string) => router.push({ pathname: '/photo', params: { chatId, messageId } }),
      onOpenFile: (_messageId: string) => undefined,
      onExpired: (messageId: string) => {
        const message = find(messageId)
        if (message) void useMessagesStore.getState().refreshAttachment(message)
      },
    }),
    [chatId, find, router, runAction],
  )

  const title = chat ? chatTitle(chat, t('chat.untitled')) : t('placeholders.chatTitle')
  const avatar = chat ? chatAvatar(chat, t('chat.untitled')) : null

  const header = (
    <Stack.Screen
      options={{
        headerTitle: () =>
          chat && avatar ? (
            <View style={styles.headerTitle} accessible accessibilityRole="header" accessibilityLabel={title}>
              <Avatar name={avatar.name} seed={avatar.seed} src={avatar.src} size="sm" />
              <View style={styles.headerText}>
                <AppText weight={600} numberOfLines={1}>
                  {title}
                </AppText>
                {chat.type === 'group' ? (
                  <AppText size="xs" color="textMuted" numberOfLines={1}>
                    {t('chat.members', { count: chat.member_count })}
                  </AppText>
                ) : null}
              </View>
            </View>
          ) : (
            <AppText weight={600}>{title}</AppText>
          ),
        headerRight: () =>
          chat?.type === 'group' ? (
            <Pressable
              onPress={() => router.push({ pathname: '/chats/info/[id]', params: { id: chatId } })}
              accessibilityRole="button"
              accessibilityLabel={t('chat.conversation.info')}
              style={styles.headerButton}
            >
              <Info size={22} color={colors.text} />
            </Pressable>
          ) : null,
      }}
    />
  )

  if (
    state === 'loading' ||
    (state === 'ready' && chat && !chat.is_encrypted && (!timeline || timeline.status === 'loading'))
  ) {
    return (
      <>
        {header}
        <ActivityIndicator style={styles.fill} color={colors.primary} accessibilityLabel={t('common.loading')} />
      </>
    )
  }
  if (state === 'missing' || !chat) {
    return (
      <>
        {header}
        <StateMessage
          icon={<MessageCircleOff size={40} color={colors.textMuted} />}
          title={state === 'missing' ? t('chat.conversation.notFound') : t('chat.conversation.loadError')}
          action={{ label: t('chat.conversation.backToChats'), onPress: () => router.back() }}
        />
      </>
    )
  }
  if (state === 'error' || (timeline?.status === 'error' && timeline.messages.length === 0)) {
    return (
      <>
        {header}
        <StateMessage
          title={t('chat.conversation.loadError')}
          text={timeline?.error ? errorMessage(timeline.error, t) : undefined}
          action={{ label: t('common.retry'), onPress: reload }}
        />
      </>
    )
  }
  if (chat.is_encrypted) {
    return (
      <>
        {header}
        <StateMessage
          icon={<Lock size={40} color={colors.textMuted} />}
          title={t('chat.encrypted.title')}
          text={t('chat.encrypted.notice')}
        />
      </>
    )
  }

  return (
    <>
      {header}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={headerHeight}
      >
        <MessageList
          chat={chat}
          messages={timeline?.messages ?? []}
          meId={meId}
          timeZone={user?.timezone ?? 'UTC'}
          locale={i18n.language}
          hasOlder={(timeline?.nextUrl ?? null) !== null}
          loadingOlder={timeline?.loadingOlder ?? false}
          olderError={timeline?.olderError ?? null}
          onLoadOlder={() => void useMessagesStore.getState().loadOlder(chatId)}
          onAtBottom={setAtBottom}
          listRef={(handle) => {
            listHandle.current = handle
          }}
          {...handlers}
        />
        <TypingIndicator names={typingNames} />
        <Composer chat={chat} meId={meId} onSent={() => listHandle.current?.scrollToBottom()} />
      </KeyboardAvoidingView>
      <MessageActionSheet
        actions={sheetActions}
        onRun={(key) => sheetFor && runAction(key, sheetFor)}
        onClose={() => setSheetFor(null)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: 260 },
  headerText: { flexShrink: 1 },
  headerButton: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
})
