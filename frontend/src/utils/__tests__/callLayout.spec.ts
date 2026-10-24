import { describe, expect, it } from 'vitest'

import { TILES_PER_PAGE, callOrder, gridShape, pageCount, tilesOnPage } from '@/utils/callLayout'

const people = (count: number) => Array.from({ length: count }, (_unused, index) => ({ id: `p${index + 1}` }))
const ids = (list: { id: string }[]) => list.map((person) => person.id)

describe('gridShape', () => {
  it.each([
    [1, false, 1, 1],
    [2, false, 2, 1],
    [3, false, 2, 2],
    [4, false, 2, 2],
    [5, false, 3, 3],
    [9, false, 3, 3],
    [2, true, 1, 2],
    [4, true, 2, 2],
  ])('%i tiles (phone: %s) make %i columns × %i rows', (count, phone, columns, rows) => {
    expect(gridShape(count, phone)).toEqual({ columns, rows })
  })
})

describe('pages', () => {
  it('counts pages of 9 on wide screens and of 4 on phones, never fewer than one', () => {
    expect(pageCount(0, TILES_PER_PAGE.wide)).toBe(1)
    expect(pageCount(9, TILES_PER_PAGE.wide)).toBe(1)
    expect(pageCount(10, TILES_PER_PAGE.wide)).toBe(2)
    expect(pageCount(9, TILES_PER_PAGE.phone)).toBe(3)
  })

  it('shows the tiles of the page asked for', () => {
    expect(ids(tilesOnPage(people(12), 0, 9, null))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'])
    expect(ids(tilesOnPage(people(12), 1, 9, null))).toEqual(['p10', 'p11', 'p12'])
  })

  it('keeps the person speaking on screen: they take the last place of a full page', () => {
    expect(ids(tilesOnPage(people(12), 0, 9, 'p11'))).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p11'])
  })

  it('…or join a page that has room, and nothing moves when they are already there or everyone fits', () => {
    expect(ids(tilesOnPage(people(12), 1, 9, 'p2'))).toEqual(['p10', 'p11', 'p12', 'p2'])
    expect(ids(tilesOnPage(people(12), 1, 9, 'p10'))).toEqual(['p10', 'p11', 'p12'])
    expect(ids(tilesOnPage(people(4), 0, 9, 'p3'))).toEqual(['p1', 'p2', 'p3', 'p4'])
  })

  it('a page that no longer exists (people left) shows the last one', () => {
    expect(ids(tilesOnPage(people(5), 3, 4, null))).toEqual(['p5'])
  })

  it('a speaker who already left changes nothing', () => {
    expect(ids(tilesOnPage(people(10), 0, 9, 'gone'))).toHaveLength(9)
  })
})

describe('callOrder', () => {
  it('puts you first, then everyone in the order they arrived', () => {
    const order = callOrder([
      { id: 'b', isLocal: false, joinedAt: 30 },
      { id: 'me', isLocal: true, joinedAt: 50 },
      { id: 'a', isLocal: false, joinedAt: 10 },
    ])
    expect(ids(order)).toEqual(['me', 'a', 'b'])
  })
})
