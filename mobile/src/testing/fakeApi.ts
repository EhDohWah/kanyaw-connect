// Ported from frontend/src/__tests__/helpers.ts (fakeApi): answers requests in tests without a server.
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { AxiosError } from 'axios'

import { http } from '@/api/http'

export interface Call {
  method: string
  url: string
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

/** Every request goes to `respond` instead of the network. Returns the calls, in order. */
export function fakeApi(respond: Responder): { calls: Call[] } {
  const calls: Call[] = []
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const body = typeof config.data === 'string' ? safeJson(config.data) : config.data
    const call: Call = {
      method: (config.method ?? 'get').toLowerCase(),
      url: config.url ?? '',
      headers: { ...(config.headers?.toJSON?.() ?? config.headers) },
      body,
    }
    calls.push(call)
    const reply = await respond(call)
    if (reply.network) throw new AxiosError('Network Error', 'ERR_NETWORK', config)

    const response: AxiosResponse = {
      data: reply.data ?? {},
      status: reply.status ?? 200,
      statusText: '',
      headers: reply.headers ?? {},
      config,
    }
    if (response.status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${response.status}`,
        'ERR_BAD_RESPONSE',
        config,
        null,
        response,
      )
    }
    return response
  }
  http.defaults.adapter = adapter
  return { calls }
}

export function restoreApi(): void {
  http.defaults.adapter = realAdapter
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
