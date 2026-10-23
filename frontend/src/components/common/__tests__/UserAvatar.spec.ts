import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import UserAvatar from '@/components/common/UserAvatar.vue'

describe('UserAvatar', () => {
  it('shows initials on a coloured circle when there is no picture', () => {
    const wrapper = mount(UserAvatar, { props: { name: 'Naw Paw Say', seed: 'user-1' } })

    expect(wrapper.text()).toBe('NS')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.classes().some((name) => /^bg-avatar-[1-8]$/.test(name))).toBe(true)
  })

  it('gives the same person the same colour every time', () => {
    const one = mount(UserAvatar, { props: { name: 'A', seed: 'same' } }).classes()
    const two = mount(UserAvatar, { props: { name: 'B', seed: 'same' } }).classes()

    expect(one.find((name) => name.startsWith('bg-avatar'))).toBe(two.find((name) => name.startsWith('bg-avatar')))
  })

  it('shows the picture when there is one', () => {
    const wrapper = mount(UserAvatar, { props: { name: 'Naw Paw Say', src: 'https://cdn.example/a.webp' } })

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example/a.webp')
    expect(wrapper.text()).toBe('')
  })

  it('falls back to initials when the picture cannot be loaded, and tries again for a new picture', async () => {
    const wrapper = mount(UserAvatar, { props: { name: 'Naw Paw Say', src: 'https://cdn.example/broken.webp' } })

    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('NS')

    await wrapper.setProps({ src: 'https://cdn.example/new.webp' })
    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example/new.webp')
  })

  it('is hidden from screen readers: the name is always written beside it', () => {
    expect(mount(UserAvatar, { props: { name: 'X' } }).attributes('aria-hidden')).toBe('true')
  })
})
