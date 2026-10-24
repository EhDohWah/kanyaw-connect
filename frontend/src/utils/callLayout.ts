/** How the call's video tiles are laid out. Plain functions, so the rules can be tested without a screen. */

/** Tiles on one page: a 3×3 grid on wider screens, a 2×2 grid on phones. */
export const TILES_PER_PAGE = { wide: 9, phone: 4 } as const

export interface GridShape {
  columns: number
  rows: number
}

/**
 * The grid for this many tiles on one page: 1 fills the screen, 2 sit side by side (one above the other on a phone held
 * upright, where side by side would make two slivers), 3–4 make a 2×2 grid, 5–9 a 3×3 grid.
 */
export function gridShape(count: number, phone: boolean): GridShape {
  if (count <= 1) return { columns: 1, rows: 1 }
  if (count === 2) return phone ? { columns: 1, rows: 2 } : { columns: 2, rows: 1 }
  if (count <= 4) return { columns: 2, rows: 2 }
  return { columns: 3, rows: 3 }
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage))
}

/**
 * The tiles of one page. When there is more than one page, the person speaking stays on screen: if they are on another
 * page, they take the last place on this one.
 */
export function tilesOnPage<T extends { id: string }>(people: T[], page: number, perPage: number, speakerId: string | null): T[] {
  const last = pageCount(people.length, perPage) - 1
  const start = Math.min(Math.max(page, 0), last) * perPage
  const tiles = people.slice(start, start + perPage)
  if (!speakerId || people.length <= perPage || tiles.some((person) => person.id === speakerId)) return tiles

  const speaker = people.find((person) => person.id === speakerId)
  if (!speaker) return tiles
  return tiles.length < perPage ? [...tiles, speaker] : [...tiles.slice(0, -1), speaker]
}

/** You first, then everyone else in the order they arrived: tiles do not jump around as people speak. */
export function callOrder<T extends { isLocal: boolean; joinedAt: number; id: string }>(people: T[]): T[] {
  return [...people].sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
}
