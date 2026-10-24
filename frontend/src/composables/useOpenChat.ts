import { useRoute, useRouter } from 'vue-router'

import { useMediaQuery } from '@/composables/useMediaQuery'
import { useUiStore } from '@/stores/ui'

/**
 * Opens a chat in the right place: in the docked drawer on a wide screen (so the page behind it stays), on its own
 * page everywhere else, and always on the page when already on a Messages page.
 */
export function useOpenChat(): (chatId: string) => void {
  const router = useRouter()
  const route = useRoute()
  const ui = useUiStore()
  const wide = useMediaQuery('(min-width: 1024px)')

  return (chatId: string) => {
    const onMessagesPage = route.name === 'chats' || route.name === 'chat'
    if (wide.value && !onMessagesPage) ui.openDrawer(chatId)
    else void router.push({ name: 'chat', params: { id: chatId } })
  }
}
