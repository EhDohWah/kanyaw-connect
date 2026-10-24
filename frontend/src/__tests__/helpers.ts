import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, type Router } from 'vue-router'
import type { Component } from 'vue'

import { http } from '@/api/http'
import { i18n } from '@/i18n'
import { useAuthStore } from '@/stores/auth'
import { createAppRouter } from '@/router'
import type { User } from '@/types/user'

/* --------------------------------------------------------------------------------------- fake server --- */

export interface Call {
  method: string
  url: string
  /** The full address as it went out, with the query string. */
  uri: string
  headers: Record<string, unknown>
  /** The request body: parsed if it was JSON, the FormData itself for uploads. */
  body: unknown
}

export interface Reply {
  status?: number
  data?: unknown
  headers?: Record<string, string>
  /** Behave as if the server never answered (offline). */
  network?: boolean
}

type Responder = (call: Call) => Reply | Promise<Reply>

const realAdapter = http.defaults.adapter

/**
 * Replaces the network with a function. Every request the app makes is recorded in `calls` and answered by
 * `respond`, so tests run the real API client (interceptors, ApiError) without a server.
 */
export function fakeApi(respond: Responder): { calls: Call[] } {
  const calls: Call[] = []

  http.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const raw = config.data as unknown
    const call: Call = {
      method: (config.method ?? 'get').toLowerCase(),
      url: config.url ?? '',
      uri: http.getUri(config),
      headers: config.headers.toJSON() as Record<string, unknown>,
      body: typeof raw === 'string' && raw !== '' ? (JSON.parse(raw) as unknown) : raw,
    }
    calls.push(call)

    const reply = await respond(call)
    if (reply.network) throw new AxiosError('Network Error', 'ERR_NETWORK', config)

    const status = reply.status ?? 200
    const response: AxiosResponse = {
      data: reply.data ?? null,
      status,
      statusText: '',
      headers: reply.headers ?? {},
      config,
      request: {},
    }
    if (status >= 200 && status < 300) return response

    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    )
  }

  return { calls }
}

export function restoreApi(): void {
  http.defaults.adapter = realAdapter
}

/* ------------------------------------------------------------------------------------------- fixtures --- */

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '0195e2c4-0001-7a00-8100-5f3a9c000000',
    name: 'Saw Eh Doh',
    email: 'eh@example.org',
    phone: null,
    email_verified_at: null,
    avatar_url: null,
    avatar_thumb_url: null,
    status: 'offline',
    last_seen_at: null,
    timezone: 'Asia/Bangkok',
    locale: 'en',
    settings: {},
    created_at: '2026-03-14T09:00:00.000000Z',
    ...overrides,
  }
}

export const LOGIN_REPLY = (user: User = makeUser()): Reply => ({
  data: { token: '1|secret-token', expires_at: '2099-01-01T00:00:00+00:00', user },
})

export function signIn(token = '1|secret-token', expiresAt = '2099-01-01T00:00:00+00:00'): void {
  window.localStorage.setItem('kc.token', token)
  window.localStorage.setItem('kc.tokenExpiresAt', expiresAt)
}

/* ---------------------------------------------------------------------------------------------- mounting --- */

const mounted: VueWrapper[] = []

/** Unmounts everything `mountApp` created, so timers (the heartbeat) and listeners do not leak into the next test. */
export function unmountAll(): void {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
}

export interface Mounted {
  wrapper: VueWrapper
  router: Router
  pinia: Pinia
}

/** Mounts a component with a fresh store, the real routes (in memory) and the real translations. */
export async function mountApp(
  component: Component,
  options: {
    route?: string
    props?: Record<string, unknown>
    attachTo?: HTMLElement
    /** Puts the stores in a known state (a signed-in person, some chats) before the route is opened and anything is drawn. */
    prepare?: (pinia: Pinia) => void
  } = {},
): Promise<Mounted> {
  const pinia = createPinia()
  setActivePinia(pinia)
  options.prepare?.(pinia)

  const router = createAppRouter(createMemoryHistory())
  await router.push(options.route ?? '/')
  await router.isReady()

  const wrapper = mount(component, {
    props: options.props ?? {},
    ...(options.attachTo ? { attachTo: options.attachTo } : {}),
    global: { plugins: [pinia, router, i18n] },
  })

  mounted.push(wrapper)
  return { wrapper, router, pinia }
}

/** Waits for pending promises and timers' microtasks: enough for "click, then the request finishes, then the DOM updates". */
export async function settle(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** An empty page in the API's list shape. */
export function page<T>(data: T[], next: string | null = null) {
  return { data, links: { first: null, last: null, prev: null, next }, meta: { path: '', per_page: 30, next_cursor: null, prev_cursor: null } }
}

/* ------------------------------------------------------------------------------ chat fixtures --- */

import type { Chat, ChatMember, Message, MemberRole } from '@/types/chat'
import type { PublicUser } from '@/types/user'

export const ME = '0195e2c4-0001-7a00-8100-5f3a9c000000'
export const PAW = '0195e2c4-0003-7a02-8102-5f3a9c003dde'

export function person(id: string, name: string): PublicUser {
  return { id, name, avatar_url: null, avatar_thumb_url: null }
}

let counter = 0

/** Messages made in a row get increasing ids and times, like real ones. */
export function makeMessage(overrides: Partial<Message> = {}): Message {
  counter += 1
  const n = String(counter).padStart(6, '0')
  const sender = overrides.sender_id === undefined || overrides.sender_id === PAW ? person(PAW, 'Naw Paw Say') : person(ME, 'Saw Eh Doh')
  return {
    id: `0195e2c4-${n}-7a00-8100-5f3a9c000000`,
    chat_id: CHAT_ID,
    sender,
    sender_id: sender.id,
    type: 'text',
    content: `Message ${counter}`,
    reply_to_id: null,
    reply_to: null,
    is_edited: false,
    edited_at: null,
    metadata: {},
    encrypted: false,
    attachment: null,
    created_at: `2026-03-14T09:${String(Math.floor(counter / 60)).padStart(2, '0')}:${String(counter % 60).padStart(2, '0')}.000000Z`,
    ...overrides,
  }
}

export const CHAT_ID = '0195e2c4-0004-7a03-8103-5f3a9c005ccd'

export function makeMember(user: PublicUser, role: MemberRole = 'member'): ChatMember {
  return { user, user_id: user.id, role, joined_at: '2026-03-14T09:00:00.000000Z' }
}

export function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: CHAT_ID,
    type: 'direct',
    name: null,
    description: null,
    avatar_url: null,
    is_encrypted: false,
    member_count: 2,
    last_message_at: '2026-03-14T09:00:46.209458Z',
    created_at: '2026-03-14T09:00:00.000000Z',
    unread_count: 0,
    my_membership: {
      role: 'member',
      joined_at: '2026-03-14T09:00:00.000000Z',
      last_read_message_id: null,
      last_read_at: null,
      is_muted: false,
      muted_until: null,
      is_archived: false,
      pin_position: null,
    },
    latest_message: null,
    other_user: person(PAW, 'Naw Paw Say'),
    ...overrides,
  }
}

/** Signs the test person in without going through the login screen: a token and the profile are already known. */
export function signedInStores(pinia: Pinia, user: User = makeUser({ id: ME })): void {
  signIn()
  const auth = useAuthStore(pinia)
  auth.token = '1|secret-token'
  auth.user = user
}
