import { createEcho } from '@/realtime/echo'
import { RealtimeManager } from '@/realtime/manager'

/** The app's one connection. Tests create their own `RealtimeManager` with a fake Echo. */
export const realtime = new RealtimeManager(createEcho)
