import type { Room } from '@/types/room'

/** The room shown by the development layout preview. */
export function makeDemoRoom(me: { id: string; name: string }): Room {
  return {
    id: 'demo',
    type: 'instant',
    name: 'Layout preview',
    description: null,
    host: { id: me.id, name: me.name, avatar_url: null, avatar_thumb_url: null },
    host_id: me.id,
    chat_id: null,
    has_password: false,
    waiting_room_enabled: false,
    is_locked: false,
    max_participants: 50,
    scheduled_at: null,
    duration_minutes: null,
    status: 'active',
    started_at: null,
    ended_at: null,
    recording_enabled: false,
    created_at: new Date(0).toISOString(),
    present_count: 0,
    my_participation: { role: 'host', admission: 'admitted' },
  }
}
