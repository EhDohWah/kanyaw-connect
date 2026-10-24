import type { useCallStore } from '@/stores/call'
import type { CallParticipant } from '@/types/call'
import { makeDemoRoom } from '@/mocks/demoRoom'

/**
 * Development only (`/rooms/:id?demo=4`): the call screen filled with sample people, to review the layout on one device.
 * Imported behind `import.meta.env.DEV`, so production builds do not contain it.
 */
const NAMES = ['Naw Paw', 'Saw Htoo', 'Naw Mu', 'Saw Kler', 'Naw Say', 'Saw Lah', 'Naw Hser', 'Saw Ta', 'Naw Ehler', 'Saw Poe', 'Naw Mu Wah', 'Saw Doh']
export const DEMO_MAX = 24

export function startCallDemo(call: ReturnType<typeof useCallStore>, count: number, me: { id: string; name: string }): void {
  const total = Math.min(Math.max(Math.floor(count), 1), DEMO_MAX)
  const people: CallParticipant[] = Array.from({ length: total }, (_unused, index) => ({
    id: index === 0 ? me.id : `demo-${index}`,
    name: index === 0 ? me.name : (NAMES[(index - 1) % NAMES.length] as string),
    avatarUrl: null,
    isLocal: index === 0,
    // One person is muted, one is speaking; nobody has a camera (the tiles show initials).
    micOn: index !== 2,
    cameraOn: false,
    screenSharing: false,
    speaking: index === 1,
    cameraTrack: null,
    screenTrack: null,
    joinedAt: index,
    quality: 'good',
    tokenRole: index === 0 ? 'host' : 'participant',
  }))

  call.room = makeDemoRoom(me)
  call.roles[me.id] = 'host'
  call.participants = people
  call.speakerId = total > 1 ? 'demo-1' : null
  call.phase = 'connected'
}
