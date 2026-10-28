// Ported from frontend/src/components/chat/Composer.vue. On a phone Enter makes a new line and the send button sends
// (as the web does on touch screens). Attachments and voice messages plug in through `leading` and `trailing`.
import { SendHorizontal, X } from 'lucide-react-native'
import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, TextInput, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { AppText } from '@/components/common/AppText'
import { realtime } from '@/realtime'
import { EMPTY_DRAFT, useDraftsStore } from '@/stores/drafts'
import { useMessagesStore } from '@/stores/messages'
import type { Chat, TimelineMessage } from '@/types/chat'
import { colors, fontSize, radius, space, TOUCH_TARGET } from '@/theme/tokens'
import { textStyleFor } from '@/theme/typography'
import { personById } from '@/utils/chatText'
import { errorMessage } from '@/utils/errorMessage'

/** The API's limit for a message's text (docs/API.md, 9.1). */
export const MAX_LENGTH = 5000
const MAX_BOX_HEIGHT = 140

export interface ComposerProps {
  chat: Chat
  meId: string
  /** The message was handed to the store: the list scrolls down to it. */
  onSent(): void
  /** Something to show above the box (a chosen file). */
  above?: ReactNode
  /** Before the box (the attach button). Hidden while editing. */
  leading?: ReactNode
  /**
   * In place of the send button when there is nothing to send (the microphone). Returning null keeps the send button.
   */
  idleAction?: ReactNode
  /** A file is chosen: sending is possible without text, and the box asks for a caption. */
  hasFile?: boolean
  /** Sends what is chosen (a file and its caption). Without it, the composer sends text. */
  onSendFile?(text: string, replyToId: string | null): void
  /** Replaces the whole row (recording a voice message). */
  replacement?: ReactNode
}

export function Composer({
  chat,
  meId,
  onSent,
  above,
  leading,
  idleAction,
  hasFile = false,
  onSendFile,
  replacement,
}: ComposerProps) {
  const { t, i18n } = useTranslation()
  const draft = useDraftsStore((state) => state.drafts[chat.id] ?? EMPTY_DRAFT)
  const update = useDraftsStore((state) => state.update)
  const messages = useMessagesStore((state) => state.timelines[chat.id]?.messages)
  const box = useRef<ComponentRef<typeof TextInput>>(null)
  const [problem, setProblem] = useState('')
  const [saving, setSaving] = useState(false)

  const find = (id: string | null): TimelineMessage | undefined =>
    id ? messages?.find((message) => message.id === id) : undefined
  const editing = find(draft.editingId)
  const replyingTo = find(draft.replyToId)

  const replyName = (() => {
    if (!replyingTo) return ''
    if (replyingTo.sender_id === meId) return t('common.you')
    return (
      replyingTo.sender?.name ??
      (replyingTo.sender_id ? personById(chat, replyingTo.sender_id)?.name : undefined) ??
      t('chat.someone')
    )
  })()
  const media: Record<string, string> = {
    image: t('chat.preview.photo'),
    voice: t('chat.preview.voice'),
    file: t('chat.preview.file'),
  }
  const replySnippet = replyingTo ? (replyingTo.content ?? media[replyingTo.type] ?? '') : ''

  // Starting a reply puts the cursor in the box; starting an edit also fills it with the message's text.
  useEffect(() => {
    if (draft.replyToId) box.current?.focus()
  }, [draft.replyToId])
  useEffect(() => {
    if (!draft.editingId) return
    const target = useMessagesStore
      .getState()
      .timeline(chat.id)
      ?.messages.find((message) => message.id === draft.editingId)
    useDraftsStore.getState().update(chat.id, { text: target?.content ?? '' })
    box.current?.focus()
  }, [draft.editingId, chat.id])

  const text = draft.text.trim()
  const canSend = saving ? false : editing ? text !== '' && text !== editing.content : text !== '' || hasFile

  function onChangeText(value: string): void {
    setProblem('')
    update(chat.id, { text: value })
    if (!editing) realtime.sendTyping(chat.id, meId, value.length > 0)
  }

  function cancelBar(): void {
    update(chat.id, { editingId: null, replyToId: null, ...(draft.editingId ? { text: '' } : {}) })
  }

  async function submit(): Promise<void> {
    if (!canSend) return
    setProblem('')
    realtime.sendTyping(chat.id, meId, false)

    if (editing) {
      setSaving(true)
      try {
        await useMessagesStore.getState().edit(editing, text)
        update(chat.id, { editingId: null, text: '' })
      } catch (error) {
        setProblem(isApiError(error) ? errorMessage(error, t) : t('chat.composer.editFailed'))
      } finally {
        setSaving(false)
      }
      return
    }

    const replyToId = draft.replyToId
    // The box empties at once; the message shows in the conversation as "sending" and the rest happens there.
    update(chat.id, { text: '', replyToId: null })
    onSent()
    if (onSendFile && hasFile) {
      onSendFile(text, replyToId)
      return
    }
    await useMessagesStore.getState().send(chat.id, { type: 'text', content: text, replyToId, file: null })
  }

  const showIdle = idleAction && !editing && text === '' && !hasFile

  return (
    <View style={styles.wrap}>
      {replyingTo || editing ? (
        <View style={styles.bar}>
          <View style={styles.barText}>
            <AppText size="xs" weight={600} color="primary" numberOfLines={1}>
              {editing ? t('chat.composer.editing') : t('chat.composer.replyingTo', { name: replyName })}
            </AppText>
            {replyingTo ? (
              <AppText size="sm" numberOfLines={1}>
                {replySnippet}
              </AppText>
            ) : null}
          </View>
          <Pressable
            onPress={cancelBar}
            accessibilityRole="button"
            accessibilityLabel={editing ? t('chat.composer.cancelEdit') : t('chat.composer.cancelReply')}
            style={styles.iconButton}
          >
            <X size={18} color={colors.text} />
          </Pressable>
        </View>
      ) : null}

      {above}

      {problem ? (
        <AppText size="sm" color="danger" accessibilityRole="alert" style={styles.problem}>
          {problem}
        </AppText>
      ) : null}

      {replacement ?? (
        <View style={styles.row}>
          {!editing ? leading : null}
          <TextInput
            ref={box}
            value={draft.text}
            onChangeText={onChangeText}
            multiline
            maxLength={MAX_LENGTH}
            placeholder={hasFile ? t('chat.composer.captionPlaceholder') : t('chat.composer.placeholder')}
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={t('chat.composer.placeholder')}
            maxFontSizeMultiplier={2}
            style={[styles.input, textStyleFor(i18n.language, fontSize.field, 400)]}
          />
          {showIdle ? (
            idleAction
          ) : (
            <Pressable
              onPress={() => void submit()}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={editing ? t('chat.composer.saveEdit') : t('chat.composer.send')}
              accessibilityState={{ disabled: !canSend, busy: saving }}
              style={({ pressed }) => [styles.send, pressed && styles.sendPressed, !canSend && styles.sendDisabled]}
            >
              <SendHorizontal size={20} color={colors.onPrimary} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: space[3],
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginBottom: space[2],
    paddingLeft: space[3],
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
  },
  barText: {
    flex: 1,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    paddingLeft: space[2],
    paddingVertical: space[1],
  },
  problem: { marginBottom: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  input: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    maxHeight: MAX_BOX_HEIGHT,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: space[3],
    paddingTop: 12,
    paddingBottom: 12,
    color: colors.text,
    textAlignVertical: 'top',
  },
  iconButton: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  send: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendPressed: { backgroundColor: colors.primaryHover },
  sendDisabled: { opacity: 0.5 },
})
