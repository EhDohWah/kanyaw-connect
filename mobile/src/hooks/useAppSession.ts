import NetInfo from '@react-native-community/netinfo'
import * as Notifications from 'expo-notifications'
import { useEffect } from 'react'
import { AppState } from 'react-native'

import { sendHeartbeat } from '@/api/me'
import { createHeartbeat } from '@/hooks/heartbeat'
import { forgetPhonePush, refreshPhonePush } from '@/push/phonePush'
import { onResync, realtimeLifecycle } from '@/realtime'
import { onBeforeSignOut, useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'
import { useRealtimeStore } from '@/stores/realtime'

/**
 * Everything that runs while someone is signed in, started by the signed-in layout: the WebSocket (open in the
 * foreground), the heartbeat (foreground only), the network state for the offline banner, the chat list, and this
 * phone's push registration (renewed at start and when the system changes the token, if the person turned it on).
 */
export function useAppSession(): void {
  const token = useAuthStore((state) => state.token)
  const userId = useAuthStore((state) => state.user?.id)

  useEffect(() => {
    if (!token || !userId) return
    // The app may have been started in the background (a call push, from 8E): then the socket waits for the foreground.
    if (AppState.currentState === 'background') realtimeLifecycle.appStateChanged('background')
    realtimeLifecycle.signIn(token, userId)
  }, [token, userId])

  useEffect(() => {
    if (!userId) return
    // Best effort: a failure here leaves notifications as they were, and nothing about it is logged.
    void refreshPhonePush(userId).catch(() => undefined)
    const tokenChange = Notifications.addPushTokenListener(() => void refreshPhonePush(userId).catch(() => undefined))
    const stopForgetting = onBeforeSignOut(forgetPhonePush)
    return () => {
      tokenChange.remove()
      stopForgetting()
    }
  }, [userId])

  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => realtimeLifecycle.appStateChanged(state))
    const network = NetInfo.addEventListener((state) => {
      // `isInternetReachable` is null until it has been checked: only a definite "no" counts.
      useRealtimeStore.getState().setNetworkOnline(state.isConnected !== false && state.isInternetReachable !== false)
    })

    const heartbeat = createHeartbeat({ send: () => sendHeartbeat() })
    heartbeat.start()

    const stopResync = onResync(() => void useChatsStore.getState().refresh())
    void useChatsStore.getState().load()

    return () => {
      appState.remove()
      network()
      heartbeat.stop()
      stopResync()
      // Leaving the signed-in screens means signing out: close the socket and forget this person's data.
      realtimeLifecycle.signOut()
      useChatsStore.getState().reset()
      useRealtimeStore.getState().reset()
    }
  }, [])
}
