/** The error body of every failed request (docs/API.md, section 1.5). */
export interface ApiErrorBody {
  message: string
  /** Field name -> messages. Only on 422. Nested fields use dots (`keys.p256dh`). */
  errors?: Record<string, string[]>
  /** Machine-readable reason for conflicts, for example `room_full`. */
  code?: string
}

export interface PageLinks {
  first: string | null
  last: string | null
  prev: string | null
  /** A full URL, or null on the last page. Request it as it is to load more. */
  next: string | null
}

export interface PageMeta {
  path: string
  per_page: number
  next_cursor: string | null
  prev_cursor: string | null
}

/** A cursor-paginated list. There are no page numbers and no totals. */
export interface Paginated<T> {
  data: T[]
  links: PageLinks
  meta: PageMeta
}

/** A single object, wrapped. */
export interface Single<T> {
  data: T
}
