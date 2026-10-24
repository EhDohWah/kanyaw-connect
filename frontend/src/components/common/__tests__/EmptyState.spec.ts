import { mount } from '@vue/test-utils'
import { Inbox } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'

import EmptyState from '@/components/common/EmptyState.vue'

describe('EmptyState', () => {
  it('a section heading by default, with its text and actions', () => {
    const wrapper = mount(EmptyState, { props: { icon: Inbox, title: 'No chats yet', text: 'Start one.' }, slots: { default: '<button>New chat</button>' } })

    expect(wrapper.get('h2').text()).toBe('No chats yet')
    expect(wrapper.text()).toContain('Start one.')
    expect(wrapper.get('button').text()).toBe('New chat')
  })

  it('the main heading when it is the whole page', () => {
    const wrapper = mount(EmptyState, { props: { icon: Inbox, title: 'Page not found', level: 1 } })
    expect(wrapper.get('h1').text()).toBe('Page not found')
    expect(wrapper.find('p').exists()).toBe(false)
  })
})
