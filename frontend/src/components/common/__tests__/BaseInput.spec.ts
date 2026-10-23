import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BaseInput from '@/components/common/BaseInput.vue'
import { i18n } from '@/i18n'

function make(props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) {
  return mount(BaseInput, { props: { label: 'Email', ...props }, attrs, global: { plugins: [i18n] } })
}

describe('BaseInput', () => {
  it('ties the label to the field, so a tap on the label focuses it and screen readers announce it', () => {
    const wrapper = make()
    const input = wrapper.get('input')

    expect(wrapper.get('label').attributes('for')).toBe(input.attributes('id'))
    expect(input.attributes('id')).toBeTruthy()
  })

  it('passes attributes such as autocomplete and name to the field itself', () => {
    const input = make({}, { autocomplete: 'username', name: 'email', inputmode: 'email' }).get('input')

    expect(input.attributes('autocomplete')).toBe('username')
    expect(input.attributes('name')).toBe('email')
    expect(input.attributes('inputmode')).toBe('email')
  })

  it('works with v-model', async () => {
    const wrapper = make({ modelValue: 'a', 'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }) })

    await wrapper.get('input').setValue('b@c.org')

    expect(wrapper.props('modelValue')).toBe('b@c.org')
  })

  it('marks the field invalid and links the message to it', () => {
    const wrapper = make({ error: 'Enter your email address.', hint: 'We never share it.' })
    const input = wrapper.get('input')
    const error = wrapper.get('p.text-danger')

    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toContain(error.attributes('id'))
    expect(input.attributes('aria-describedby')).toContain(wrapper.get('p.text-text-muted').attributes('id'))
  })

  it('is not marked invalid without an error', () => {
    const input = make({ hint: 'hint' }).get('input')

    expect(input.attributes('aria-invalid')).toBeUndefined()
  })

  it('shows and hides a password with a labelled toggle that is big enough to tap', async () => {
    const wrapper = make({ type: 'password', label: 'Password' })
    const toggle = wrapper.get('button')

    expect(wrapper.get('input').attributes('type')).toBe('password')
    expect(toggle.attributes('aria-label')).toBe('Show password')
    expect(toggle.attributes('aria-pressed')).toBe('false')
    expect(toggle.classes()).toContain('w-11')

    await toggle.trigger('click')

    expect(wrapper.get('input').attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Hide password')
    expect(toggle.attributes('aria-pressed')).toBe('true')
  })

  it('has no toggle on other fields', () => {
    expect(make().find('button').exists()).toBe(false)
  })

  it('says when a field is optional', () => {
    expect(make({ optional: true }).get('label').text()).toContain('optional')
  })
})
