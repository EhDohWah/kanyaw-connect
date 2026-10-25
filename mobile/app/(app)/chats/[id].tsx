import { useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'

import { StateMessage } from '@/components/common/StateMessage'
import { useChatsStore } from '@/stores/chats'
import { chatTitle } from '@/utils/chatText'

/** Where `kanyawconnect://chats/:id` and a tap in the chat list land. The conversation itself arrives in 8C. */
export default function ConversationScreen() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChatsStore((state) => state.chats.find((entry) => entry.id === id))
  return (
    <StateMessage
      title={chat ? chatTitle(chat, t('chat.untitled')) : t('placeholders.chatTitle')}
      text={t('common.comingSoon')}
    />
  )
}
