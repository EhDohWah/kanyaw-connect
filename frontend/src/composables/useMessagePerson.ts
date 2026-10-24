import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useOpenChat } from '@/composables/useOpenChat'
import { useChatsStore } from '@/stores/chats'
import { useUiStore } from '@/stores/ui'
import type { PublicUser } from '@/types/user'

/**
 * "Message this person": opens the direct chat with them (creating it the first time) and shows it, in the drawer on
 * a wide screen or on its own page. `busyId` is the person being opened, so their row can say so and not be tapped twice.
 */
export function useMessagePerson() {
  const { t } = useI18n()
  const chats = useChatsStore()
  const ui = useUiStore()
  const openChat = useOpenChat()
  const busyId = ref<string | null>(null)

  async function message(person: PublicUser): Promise<void> {
    if (busyId.value) return

    busyId.value = person.id
    try {
      const chat = await chats.openDirect(person.id)
      openChat(chat.id)
    } catch {
      ui.toast(t('people.openFailed'), 'error')
    } finally {
      busyId.value = null
    }
  }

  return { message, busyId }
}
