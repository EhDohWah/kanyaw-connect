import { describe, expect, it } from 'vitest'

import { linkify } from '@/utils/linkify'

const links = (text: string) => linkify(text).flatMap((t) => (t.type === 'link' ? [t.href] : []))
const rejoin = (text: string) => linkify(text).map((t) => t.value).join('')

describe('linkify', () => {
  it('finds http and https links, and gives them back as data, not markup', () => {
    expect(linkify('See https://example.org/page now')).toEqual([
      { type: 'text', value: 'See ' },
      { type: 'link', value: 'https://example.org/page', href: 'https://example.org/page' },
      { type: 'text', value: ' now' },
    ])
  })

  it('adds https to links that start with www', () => {
    expect(links('go to www.example.org today')).toEqual(['https://www.example.org'])
  })

  it('keeps the sentence’s punctuation out of the link', () => {
    expect(links('Read https://example.org/a.')).toEqual(['https://example.org/a'])
    expect(links('Really? https://example.org/a!')).toEqual(['https://example.org/a'])
    expect(links('(see https://example.org/a)')).toEqual(['https://example.org/a'])
    expect(links('a, https://example.org/a, b')).toEqual(['https://example.org/a'])
  })

  it('keeps a closing bracket that belongs to the address', () => {
    expect(links('https://en.wikipedia.org/wiki/Karen_(people)')).toEqual(['https://en.wikipedia.org/wiki/Karen_(people)'])
  })

  it('finds several links', () => {
    expect(links('https://a.example and http://b.example')).toEqual(['https://a.example', 'http://b.example'])
  })

  it('never makes other kinds of address clickable', () => {
    expect(links('javascript:alert(1)')).toEqual([])
    expect(links('ftp://example.org/file')).toEqual([])
    expect(links('data:text/html,<script>alert(1)</script>')).toEqual([])
  })

  it('ignores things that only look like links', () => {
    expect(links('https://localhost')).toEqual([])
    expect(links('www.')).toEqual([])
  })

  it('returns plain text unchanged, including Myanmar script and markup characters', () => {
    expect(linkify('မင်္ဂလာပါ <b>hi</b> & bye')).toEqual([{ type: 'text', value: 'မင်္ဂလာပါ <b>hi</b> & bye' }])
    expect(linkify('')).toEqual([])
  })

  it('loses no character: the pieces put back together are the original', () => {
    for (const text of ['a https://x.org/a?b=1&c=2#d. b', 'www.example.org', '(https://a.example/b) end', 'plain']) {
      expect(rejoin(text)).toBe(text)
    }
  })
})
