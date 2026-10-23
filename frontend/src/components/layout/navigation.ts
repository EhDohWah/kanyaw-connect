import { House, MessageCircle, Settings, User, Video } from 'lucide-vue-next'
import type { Component } from 'vue'

export interface NavEntry {
  name: 'home' | 'chats' | 'rooms' | 'profile' | 'settings'
  to: string
  /** Key in the locale files. */
  label: string
  icon: Component
  /** `/` would match every address, so Home only counts as active on exactly `/`. */
  exact?: boolean
}

export const NAV_ENTRIES: readonly NavEntry[] = [
  { name: 'home', to: '/', label: 'nav.home', icon: House, exact: true },
  { name: 'chats', to: '/chats', label: 'nav.messages', icon: MessageCircle },
  { name: 'rooms', to: '/rooms', label: 'nav.meetings', icon: Video },
  { name: 'profile', to: '/profile', label: 'nav.profile', icon: User },
  { name: 'settings', to: '/settings', label: 'nav.settings', icon: Settings },
]

/** The bottom bar on phones has room for four places and the Create button; Settings is reached from Profile. */
export const BOTTOM_BAR_ENTRIES = NAV_ENTRIES.filter((entry) => entry.name !== 'settings')
