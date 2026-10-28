import { useRouter } from 'expo-router'
import { MessageCircle } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native'

import { ChatRow } from '@/components/chat/ChatRow'
import { AppText } from '@/components/common/AppText'
import { StateMessage } from '@/components/common/StateMessage'
import { useMinute } from '@/hooks/useMinute'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { colors, space } from '@/theme/tokens'
import { errorMessage } from '@/utils/errorMessage'

export default function ChatsScreen() {
  const { t } = useTranslation()
  const router = useRouter()
  const me = useAuthStore((state) => state.user)
  const { chats, status, error, loadingMore } = useChatsStore()
  const [refreshing, setRefreshing] = useState(false)
  const now = useMinute()

  const open = useCallback((chatId: string) => router.push(`/chats/${chatId}`), [router])

  async function pullToRefresh(): Promise<void> {
    setRefreshing(true)
    await useChatsStore.getState().refresh()
    setRefreshing(false)
  }

  if (status === 'idle' || status === 'loading') {
    return <ActivityIndicator style={styles.fill} color={colors.primary} accessibilityLabel={t('common.loading')} />
  }
  if (status === 'error') {
    return (
      <StateMessage
        title={t('chat.list.loadError')}
        text={error ? errorMessage(error, t) : undefined}
        action={{ label: t('common.retry'), onPress: () => void useChatsStore.getState().refresh() }}
      />
    )
  }

  return (
    <FlatList
      data={chats}
      keyExtractor={(chat) => chat.id}
      accessibilityLabel={t('chat.list.label')}
      renderItem={({ item }) => (
        <ChatRow chat={item} meId={me?.id ?? ''} timeZone={me?.timezone ?? 'UTC'} now={now} onPress={open} />
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} colors={[colors.primary]} />
      }
      onEndReached={() => void useChatsStore.getState().loadMore()}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        <StateMessage
          icon={<MessageCircle size={40} color={colors.textMuted} />}
          title={t('chat.list.emptyTitle')}
          text={t('chat.list.emptyText')}
        />
      }
      ListFooterComponent={
        loadingMore ? (
          <AppText color="textMuted" style={styles.footer}>
            {t('chat.list.loadingMore')}
          </AppText>
        ) : undefined
      }
      contentContainerStyle={chats.length === 0 ? styles.fill : undefined}
      style={styles.list}
    />
  )
}

const styles = StyleSheet.create({
  fill: { flexGrow: 1 },
  list: { backgroundColor: colors.bg },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space[4] + 48 + space[3] },
  footer: { textAlign: 'center', padding: space[4] },
})
