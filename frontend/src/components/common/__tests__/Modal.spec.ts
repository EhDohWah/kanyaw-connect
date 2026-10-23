import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, ref } from 'vue'

import Modal from '@/components/common/Modal.vue'
import { i18n } from '@/i18n'

// A page with an opener button, like the real app: #app holds everything except the dialog.
const Host = defineComponent({
  components: { Modal },
  setup() {
    const open = ref(false)
    return { open }
  },
  template: `
    <div>
      <button id="opener" @click="open = true">Open</button>
      <Modal :open="open" title="Create" @close="open = false">
        <button id="first">First</button>
        <button id="second">Second</button>
      </Modal>
    </div>
  `,
})

function mountHost() {
  const app = document.createElement('div')
  app.id = 'app'
  document.body.append(app)
  return mount(Host, { attachTo: app, global: { plugins: [i18n] } })
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]')
const keydown = (key: string, init: KeyboardEventInit = {}) =>
  dialog()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Modal', () => {
  it('is not in the page while closed', () => {
    mountHost()
    expect(dialog()).toBeNull()
  })

  it('opens as a labelled modal dialog, with the title as its name', async () => {
    const wrapper = mountHost()
    await wrapper.get('#opener').trigger('click')

    const element = dialog()
    expect(element).not.toBeNull()
    expect(element?.getAttribute('aria-modal')).toBe('true')
    const labelledBy = element?.getAttribute('aria-labelledby') ?? ''
    expect(document.getElementById(labelledBy)?.textContent).toBe('Create')
  })

  it('moves focus into the dialog and makes the page behind it unreachable', async () => {
    const wrapper = mountHost()
    ;(wrapper.get('#opener').element as HTMLElement).focus()
    await wrapper.get('#opener').trigger('click')
    await wrapper.vm.$nextTick()

    expect(dialog()?.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.id).toBe('first')
    expect(document.getElementById('app')?.hasAttribute('inert')).toBe(true)
  })

  it('does not start on a control that is marked unavailable: the close button gets the focus instead', async () => {
    const Unavailable = defineComponent({
      components: { Modal },
      template: `<Modal :open="true" title="Create"><button id="soon" aria-disabled="true">Soon</button></Modal>`,
    })
    const app = document.createElement('div')
    app.id = 'app'
    document.body.append(app)
    mount(Unavailable, { attachTo: app, global: { plugins: [i18n] } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
  })

  it('keeps Tab inside: from the last control back to the first', async () => {
    const wrapper = mountHost()
    await wrapper.get('#opener').trigger('click')
    await wrapper.vm.$nextTick()

    // order in the dialog: first, second, then the header's close button? No: the header comes first in the page order.
    const items = Array.from(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])
    const last = items[items.length - 1]
    const first = items[0]
    last?.focus()

    keydown('Tab')
    expect(document.activeElement).toBe(first)

    keydown('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Escape, gives the page back, and returns focus to the button that opened it', async () => {
    const wrapper = mountHost()
    const opener = wrapper.get('#opener').element as HTMLElement
    opener.focus()
    await wrapper.get('#opener').trigger('click')
    await wrapper.vm.$nextTick()

    keydown('Escape')
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 250)) // the fade-out

    expect(dialog()).toBeNull()
    expect(document.getElementById('app')?.hasAttribute('inert')).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('closes with the close button, which is labelled and at least 44 px', async () => {
    const wrapper = mountHost()
    await wrapper.get('#opener').trigger('click')

    const close = document.body.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
    expect(close).not.toBeNull()
    expect(close?.className).toContain('size-11')

    close?.click()
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(dialog()).toBeNull()
  })

  it('closes when the dark area around it is pressed, but not when the dialog itself is', async () => {
    const wrapper = mountHost()
    await wrapper.get('#opener').trigger('click')

    dialog()?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(dialog()).not.toBeNull()

    dialog()?.parentElement?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper.vm.$nextTick()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(dialog()).toBeNull()
  })

  it('gives the page back even when it is removed while open', async () => {
    const wrapper = mountHost()
    await wrapper.get('#opener').trigger('click')
    expect(document.getElementById('app')?.hasAttribute('inert')).toBe(true)

    wrapper.unmount()

    expect(document.getElementById('app')?.hasAttribute('inert')).toBe(false)
  })
})
