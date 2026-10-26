import { Link, Tabs } from 'expo-router'
import { House, MessageCircle, Settings, SquarePlus, User, Video } from 'lucide-react-native'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet } from 'react-native'

import { CreateSheet } from '@/components/common/CreateSheet'
import { useChatsStore } from '@/stores/chats'
import { colors, TOUCH_TARGET } from '@/theme/tokens'
import { headerOptions, navigationFont } from '@/theme/navigation'

export const unstable_settings = { anchor: 'index' }

/** Unread messages in chats that are not muted, for the Messages tab's badge. */
function useUnreadTotal(): number {
  return useChatsStore((state) =>
    state.chats.reduce((sum, chat) => sum + (chat.my_membership.is_muted ? 0 : chat.unread_count), 0),
  )
}

export default function TabsLayout() {
  const { t, i18n } = useTranslation()
  const [creating, setCreating] = useState(false)
  const unread = useUnreadTotal()
  const header = headerOptions(i18n.language)

  return (
    <>
      <Tabs
        // Android's back button returns to Home from another tab, then leaves the app.
        backBehavior="initialRoute"
        screenOptions={{
          headerTintColor: header.headerTintColor,
          headerTitleStyle: header.headerTitleStyle,
          headerStyle: header.headerStyle,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: navigationFont(i18n.language, 500),
          tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{ title: t('nav.home'), tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="chats"
          options={{
            title: t('nav.messages'),
            tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} />,
            tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.onPrimary },
            tabBarAccessibilityLabel:
              unread > 0 ? `${t('nav.messages')}, ${t('nav.unread', { count: unread })}` : t('nav.messages'),
          }}
        />
        <Tabs.Screen
          name="create"
          options={{
            title: t('nav.create'),
            tabBarIcon: ({ color, size }) => <SquarePlus color={color} size={size} />,
          }}
          listeners={{
            // Create is not a place: it opens the sheet and you stay where you were.
            tabPress: (event) => {
              event.preventDefault()
              setCreating(true)
            },
          }}
        />
        <Tabs.Screen
          name="rooms"
          options={{ title: t('nav.meetings'), tabBarIcon: ({ color, size }) => <Video color={color} size={size} /> }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: t('nav.profile'),
            tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
            headerRight: () => (
              <Link href="/settings" asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('nav.settings')}
                  style={styles.headerButton}
                >
                  <Settings size={22} color={colors.primary} />
                </Pressable>
              </Link>
            ),
          }}
        />
      </Tabs>
      <CreateSheet visible={creating} onClose={() => setCreating(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  headerButton: { width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
})
