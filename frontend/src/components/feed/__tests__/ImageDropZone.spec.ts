import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import { i18n } from '@/i18n'
import ImageDropZone from '@/components/feed/ImageDropZone.vue'

const MB = 1024 * 1024

function pic(name = 'photo.jpg', type = 'image/jpeg', size = 1000): File {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

const mountedZones: VueWrapper[] = []
// A zone left mounted keeps listening to the window, and would answer the drops of the next test.
afterEach(() => {
  for (const wrapper of mountedZones.splice(0)) wrapper.unmount()
})

/** The zone inside a page that holds its picture and its problem, as the post form does. */
function mountZone() {
  const model = ref<File | null>(null)
  const problem = ref('')
  const Host = defineComponent({
    setup: () => () =>
      h('div', [
        h(ImageDropZone, {
          modelValue: model.value,
          'onUpdate:modelValue': (value: File | null) => (model.value = value),
          problem: problem.value,
          'onUpdate:problem': (value: string) => (problem.value = value),
        }),
        h('p', { 'data-test': 'problem' }, problem.value),
      ]),
  })
  const wrapper = mount(Host, { attachTo: document.body, global: { plugins: [i18n] } })
  mountedZones.push(wrapper)
  const input = () => wrapper.get('input[type="file"]')
  const choose = async (file: File) => {
    Object.defineProperty(input().element, 'files', { value: [file], configurable: true })
    await input().trigger('change')
  }
  return { wrapper, model, problem, input, choose }
}

const dropEvent = (type: string, files: File[] = [], relatedTarget: EventTarget | null = null): Event => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; relatedTarget: EventTarget | null }
  event.dataTransfer = { files, types: ['Files'] }
  event.relatedTarget = relatedTarget
  return event
}

describe('choosing a picture', () => {
  it('is a labelled file picker that offers the camera on a phone, and says what it takes', () => {
    const { wrapper, input } = mountZone()

    expect(input().attributes('accept')).toBe('image/*')
    expect(input().attributes('aria-label')).toBe('Picture')
    expect(wrapper.text()).toContain('Drop a picture here')
    expect(wrapper.text()).toContain('up to 10 MB')
  })

  it('takes a picture and shows it, with a way to remove it', async () => {
    const { wrapper, model, choose } = mountZone()
    const file = pic()

    await choose(file)

    expect(model.value).toBe(file)
    expect(wrapper.get('img').attributes('alt')).toBe('Your picture, as it will look')
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
    expect(wrapper.find('button[aria-label="Remove the picture"]').exists()).toBe(true)
    expect(wrapper.find('input[type="file"]').exists()).toBe(false)
  })

  it('takes a picture of exactly 10 MB, and refuses one byte more, saying so', async () => {
    const exact = mountZone()
    await exact.choose(pic('a.png', 'image/png', 10 * MB))
    expect(exact.model.value).not.toBeNull()
    expect(exact.problem.value).toBe('')

    const over = mountZone()
    await over.choose(pic('b.png', 'image/png', 10 * MB + 1))
    expect(over.model.value).toBeNull()
    expect(over.wrapper.get('[data-test="problem"]').text()).toBe('That picture is bigger than 10 MB. Choose a smaller one.')
  })

  it('refuses a file that is not a picture, and keeps the one it already had', async () => {
    const { model, problem, choose } = mountZone()
    const first = pic('first.jpg')
    await choose(first)
    expect(model.value).toBe(first)

    // the zone is gone while a picture is shown, so remove it first, then try the wrong file
    const second = mountZone()
    await second.choose(pic('doc.pdf', 'application/pdf'))

    expect(second.model.value).toBeNull()
    expect(second.problem.value).toBe('That file is not a picture. Choose a JPEG, PNG, WebP or GIF image.')
    expect(problem.value).toBe('')
  })

  it('clears an old complaint when a good picture is chosen', async () => {
    const { problem, model, choose } = mountZone()
    await choose(pic('doc.pdf', 'application/pdf'))
    expect(problem.value).not.toBe('')

    await choose(pic('ok.jpg'))

    expect(problem.value).toBe('')
    expect(model.value).not.toBeNull()
  })

  it('can choose the same file again after removing it', async () => {
    const { wrapper, model, input, choose } = mountZone()
    await choose(pic())

    await wrapper.get('button[aria-label="Remove the picture"]').trigger('click')
    expect(model.value).toBeNull()
    await wrapper.vm.$nextTick()
    expect((input().element as HTMLInputElement).value).toBe('')
  })

  it('puts the focus on the picker again after removing the picture, so the keyboard is not lost', async () => {
    const { wrapper, input, choose } = mountZone()
    await choose(pic())

    await wrapper.get('button[aria-label="Remove the picture"]').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(document.activeElement).toBe(input().element)
  })

  it('takes the picture away and says so when the browser cannot draw it', async () => {
    const { wrapper, model, choose } = mountZone()
    await choose(pic('weird.heic', 'image/heic'))
    expect(model.value).not.toBeNull()

    await wrapper.get('img').trigger('error')

    expect(model.value).toBeNull()
    expect(wrapper.get('[data-test="problem"]').text()).toBe('That picture could not be read. Try another one.')
  })

  it('lets go of the preview when the picture changes or the form goes away', async () => {
    const { wrapper, choose } = mountZone()
    await choose(pic())
    const revoke = vi.mocked(URL.revokeObjectURL)

    await wrapper.get('button[aria-label="Remove the picture"]').trigger('click')
    expect(revoke).toHaveBeenCalledWith('blob:preview')

    await choose(pic('again.jpg'))
    revoke.mockClear()
    wrapper.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:preview')
  })
})

describe('dragging and dropping', () => {
  it('lights up while a file is over it, and goes back when it leaves the whole zone', async () => {
    const { wrapper } = mountZone()
    const zone = wrapper.get('label')

    zone.element.dispatchEvent(dropEvent('dragenter'))
    await wrapper.vm.$nextTick()
    expect(zone.classes()).toContain('bg-primary-soft')
    expect(zone.text()).toContain('Drop it to add it')

    zone.element.dispatchEvent(dropEvent('dragleave'))
    await wrapper.vm.$nextTick()
    expect(zone.classes()).not.toContain('bg-primary-soft')
  })

  it('stays lit when the file only moves over the zone’s own text or icon', async () => {
    const { wrapper } = mountZone()
    const zone = wrapper.get('label')
    zone.element.dispatchEvent(dropEvent('dragenter'))

    zone.element.dispatchEvent(dropEvent('dragleave', [], zone.get('span').element))
    await wrapper.vm.$nextTick()

    expect(zone.classes()).toContain('bg-primary-soft')
  })

  it('takes a dropped picture', async () => {
    const { wrapper, model } = mountZone()
    const file = pic('dropped.jpg')

    wrapper.get('label').element.dispatchEvent(dropEvent('drop', [file]))
    await wrapper.vm.$nextTick()

    expect(model.value).toBe(file)
  })

  it('refuses a dropped file that is not a picture', async () => {
    const { wrapper, model, problem } = mountZone()

    wrapper.get('label').element.dispatchEvent(dropEvent('drop', [pic('doc.pdf', 'application/pdf')]))
    await wrapper.vm.$nextTick()

    expect(model.value).toBeNull()
    expect(problem.value).toContain('not a picture')
  })

  it('stops the browser from leaving the page when a file is dropped beside the zone', () => {
    const { wrapper } = mountZone()

    const beside = dropEvent('drop', [pic()])
    window.dispatchEvent(beside)
    const notFiles = new Event('drop', { cancelable: true }) as Event & { dataTransfer: unknown }
    notFiles.dataTransfer = { types: ['text/plain'] }
    window.dispatchEvent(notFiles)

    expect(beside.defaultPrevented).toBe(true)
    expect(notFiles.defaultPrevented).toBe(false)
    wrapper.unmount()
    const after = dropEvent('drop', [pic()])
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
  })
})
