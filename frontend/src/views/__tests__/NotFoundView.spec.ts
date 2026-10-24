import { describe, expect, it } from 'vitest'

import { mountApp } from '@/__tests__/helpers'
import NotFoundView from '@/views/NotFoundView.vue'

describe('NotFoundView', () => {
  it('says the page is not there, as the page\'s main heading, with a way home', async () => {
    const { wrapper } = await mountApp(NotFoundView)

    expect(wrapper.findAll('h1').map((h) => h.text())).toEqual(['Page not found'])
    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.get('a').attributes('href')).toBe('/')
  })
})
