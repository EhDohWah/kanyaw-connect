import type { StoreApi, UseBoundStore } from 'zustand'

type Extras<S> = Record<string, (state: S) => unknown>

/**
 * A view of a Zustand store that always reads the current state, so tests ported from the web's Pinia stores can keep
 * writing `chats.status` and `chats.put(...)`. Assigning a property sets that piece of state. `extras` adds read-only
 * names the web store had as computed values (`hasMore`, `totalUnread`).
 */
export function live<S extends object>(
  store: UseBoundStore<StoreApi<S>>,
  extras: Extras<S> = {},
): S & Record<string, any> {
  return new Proxy({} as S & Record<string, any>, {
    get: (_target, key: string) => (key in extras ? extras[key]!(store.getState()) : (store.getState() as any)[key]),
    set: (_target, key: string, value) => {
      store.setState({ [key]: value } as Partial<S>)
      return true
    },
  })
}

/** A promise with its resolve and reject on the outside, to finish a fake request when the test chooses. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
