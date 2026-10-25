// Ported from frontend/src/api/__tests__/http.spec.ts.
import { ApiError } from '@/api/errors'
import { http, setSocketIdResolver, setUnauthorizedHandler } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import { fakeApi, restoreApi } from '@/testing/fakeApi'

/** Signed in with this token, as far as the API client can tell (the store is its token source). */
function signIn(token: string | null): void {
  useAuthStore.setState({ token, status: token ? 'signedIn' : 'signedOut' })
}

beforeEach(() => {
  signIn(null)
  setSocketIdResolver(() => undefined)
})
afterEach(() => {
  restoreApi()
  jest.useRealTimers()
})

describe('request headers', () => {
  it('sends Accept: application/json and the bearer token', async () => {
    signIn('1|abc')
    const { calls } = fakeApi(() => ({ data: {} }))

    await http.get('/me')

    expect(calls[0]?.headers.Accept).toBe('application/json')
    expect(calls[0]?.headers.Authorization).toBe('Bearer 1|abc')
  })

  it('sends no Authorization header when signed out, or when skipAuth is set', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    await http.get('/open')

    signIn('1|abc')
    await http.post('/auth/login', {}, { skipAuth: true })

    expect(calls[0]?.headers.Authorization).toBeUndefined()
    expect(calls[1]?.headers.Authorization).toBeUndefined()
  })

  it('adds X-Socket-ID to requests that change something, never to reads', async () => {
    setSocketIdResolver(() => '123.456')
    const { calls } = fakeApi(() => ({ data: {} }))

    await http.get('/chats')
    await http.post('/chats/1/messages', {})
    await http.patch('/me', {})
    await http.delete('/messages/1')

    expect(calls.map((call) => call.headers['X-Socket-ID'])).toEqual([undefined, '123.456', '123.456', '123.456'])
  })

  it('leaves X-Socket-ID out when there is no connection yet', async () => {
    const { calls } = fakeApi(() => ({ data: {} }))
    await http.post('/me/heartbeat', {})

    expect(calls[0]?.headers['X-Socket-ID']).toBeUndefined()
  })
})

describe('errors', () => {
  it('rejects with an ApiError carrying status, code and field errors', async () => {
    fakeApi(() => ({ status: 422, data: { message: 'Invalid', errors: { email: ['Bad'] } } }))

    const error = await http.post('/auth/register', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
    expect((error as ApiError).fieldError('email')).toBe('Bad')
  })

  it('keeps the 409 code and the whole body (call_not_ringing carries the call)', async () => {
    fakeApi(() => ({
      status: 409,
      data: { message: 'No longer ringing.', code: 'call_not_ringing', call: { id: 'c1' } },
    }))

    const error = (await http.post('/calls/c1/accept').catch((e: unknown) => e)) as ApiError

    expect(error.code).toBe('call_not_ringing')
    expect(error.body).toMatchObject({ call: { id: 'c1' } })
  })

  it('rejects with a network ApiError when the server cannot be reached', async () => {
    fakeApi(() => ({ network: true }))

    const error = (await http.get('/me').catch((e: unknown) => e)) as ApiError

    expect(error.isNetwork).toBe(true)
    expect(error.code).toBe('network')
  })
})

describe('401', () => {
  it('calls the unauthorized hook when the token we hold is refused', async () => {
    signIn('1|abc')
    const handler = jest.fn()
    setUnauthorizedHandler(handler)
    fakeApi(() => ({ status: 401, data: { message: 'Unauthenticated.' } }))

    const error = (await http.get('/me').catch((e: unknown) => e)) as ApiError

    expect(error.status).toBe(401)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('ignores a 401 for a token that is no longer the current one (a late answer must not sign out a new session)', async () => {
    signIn('1|old')
    const handler = jest.fn()
    setUnauthorizedHandler(handler)
    fakeApi(() => {
      signIn('2|new') // signed in again while the request was in flight
      return { status: 401, data: { message: 'Unauthenticated.' } }
    })

    await http.get('/me').catch(() => undefined)

    expect(handler).not.toHaveBeenCalled()
  })

  it('does not call the hook for a request that carried no token', async () => {
    const handler = jest.fn()
    setUnauthorizedHandler(handler)
    fakeApi(() => ({ status: 401, data: {} }))

    await http.get('/open').catch(() => undefined)

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('429', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  it('waits for Retry-After and repeats a GET once', async () => {
    let attempt = 0
    const { calls } = fakeApi(() => {
      attempt += 1
      return attempt === 1
        ? { status: 429, headers: { 'retry-after': '3' }, data: { message: 'Slow down' } }
        : { data: { ok: true } }
    })

    const pending = http.get('/chats')
    await jest.advanceTimersByTimeAsync(2900)
    expect(calls).toHaveLength(1)

    await jest.advanceTimersByTimeAsync(200)
    const response = await pending

    expect(calls).toHaveLength(2)
    expect(response.data).toEqual({ ok: true })
  })

  it('gives up after one repeat', async () => {
    const { calls } = fakeApi(() => ({ status: 429, headers: { 'retry-after': '1' }, data: { message: 'Slow down' } }))

    const pending = http.get('/chats').catch((e: unknown) => e)
    await jest.advanceTimersByTimeAsync(5000)
    const error = (await pending) as ApiError

    expect(calls).toHaveLength(2)
    expect(error.status).toBe(429)
    expect(error.retryAfter).toBe(1)
  })

  it('does not repeat a POST on its own (it might not be safe to send twice)', async () => {
    const { calls } = fakeApi(() => ({ status: 429, headers: { 'retry-after': '1' }, data: {} }))

    const error = (await http.post('/auth/login', {}).catch((e: unknown) => e)) as ApiError

    expect(calls).toHaveLength(1)
    expect(error.status).toBe(429)
  })

  it('repeats a POST that opts in with retryOn429', async () => {
    let attempt = 0
    const { calls } = fakeApi(() => {
      attempt += 1
      return attempt === 1 ? { status: 429, headers: { 'retry-after': '1' }, data: {} } : { data: {} }
    })

    const pending = http.post('/something', {}, { retryOn429: true })
    await jest.advanceTimersByTimeAsync(1500)
    await pending

    expect(calls).toHaveLength(2)
  })

  it('shows long waits to the person instead of silently waiting', async () => {
    const { calls } = fakeApi(() => ({ status: 429, headers: { 'retry-after': '60' }, data: {} }))

    const error = (await http.get('/chats').catch((e: unknown) => e)) as ApiError

    expect(calls).toHaveLength(1)
    expect(error.retryAfter).toBe(60)
  })
})
