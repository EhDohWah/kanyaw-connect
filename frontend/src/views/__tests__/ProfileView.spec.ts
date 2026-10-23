import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeApi, makeUser, mountApp, restoreApi, settle, signIn, type Call } from '@/__tests__/helpers'
import { useUiStore } from '@/stores/ui'
import ProfileView from '@/views/ProfileView.vue'

beforeEach(() => {
  signIn()
  URL.createObjectURL = vi.fn(() => 'blob:preview') as typeof URL.createObjectURL
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL
})
afterEach(restoreApi)

function serve(overrides: (call: Call) => ReturnType<Parameters<typeof fakeApi>[0]> | undefined = () => undefined, user = makeUser({ phone: '0812345678' })) {
  return fakeApi((call) => overrides(call) ?? { data: { data: user } })
}

async function open() {
  return mountApp(ProfileView, { route: '/profile' })
}

async function choose(wrapper: Awaited<ReturnType<typeof open>>['wrapper'], file: File) {
  const input = wrapper.get('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await settle()
}

describe('ProfileView: details', () => {
  it('shows the profile, with the email locked', async () => {
    serve()
    const { wrapper } = await open()
    await settle()

    expect((wrapper.get('input[name=name]').element as HTMLInputElement).value).toBe('Saw Eh Doh')
    expect((wrapper.get('input[name=phone]').element as HTMLInputElement).value).toBe('0812345678')
    const email = wrapper.get('input[name=email]')
    expect((email.element as HTMLInputElement).value).toBe('eh@example.org')
    expect(email.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain("Your email address can't be changed.")
  })

  it('keeps Save switched off until something changes', async () => {
    serve()
    const { wrapper } = await open()
    await settle()

    const save = () => wrapper.get('form button[type=submit]')
    expect(save().attributes('disabled')).toBeDefined()

    await wrapper.get('input[name=name]').setValue('Saw Eh Doh Jr')
    expect(save().attributes('disabled')).toBeUndefined()

    await wrapper.get('input[name=name]').setValue('Saw Eh Doh')
    expect(save().attributes('disabled')).toBeDefined()
  })

  it('sends only what changed, and says it was saved', async () => {
    const { calls } = serve((call) => (call.method === 'patch' ? { data: { data: makeUser({ name: 'New Name', phone: '0812345678' }) } } : undefined))
    const { wrapper, pinia } = await open()
    await settle()

    await wrapper.get('input[name=name]').setValue('New Name')
    await wrapper.get('form').trigger('submit')
    await settle()

    const patch = calls.find((call) => call.method === 'patch')
    expect(patch?.url).toBe('/me')
    expect(patch?.body).toEqual({ name: 'New Name' })
    expect(useUiStore(pinia).toasts.map((toast) => toast.message)).toEqual(['Profile saved'])
  })

  it('shows what the server kept after saving, and switches Save off again', async () => {
    serve((call) => (call.method === 'patch' ? { data: { data: makeUser({ name: 'Naw Tidy Name', phone: '0812345678' }) } } : undefined))
    const { wrapper } = await open()
    await settle()

    await wrapper.get('input[name=name]').setValue('naw   tidy name')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect((wrapper.get('input[name=name]').element as HTMLInputElement).value).toBe('Naw Tidy Name')
    expect(wrapper.get('form button[type=submit]').attributes('disabled')).toBeDefined()
  })

  it('removes the phone number by sending null when the field is emptied', async () => {
    const { calls } = serve((call) => (call.method === 'patch' ? { data: { data: makeUser() } } : undefined))
    const { wrapper } = await open()
    await settle()

    await wrapper.get('input[name=phone]').setValue('')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls.find((call) => call.method === 'patch')?.body).toEqual({ phone: null })
  })

  it('changes the time zone', async () => {
    const { calls } = serve((call) => (call.method === 'patch' ? { data: { data: makeUser({ timezone: 'Australia/Sydney' }) } } : undefined))
    const { wrapper } = await open()
    await settle()

    const select = wrapper.findAll('select').find((s) => s.findAll('option').some((o) => o.element.value === 'Australia/Sydney'))
    await select?.setValue('Australia/Sydney')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls.find((call) => call.method === 'patch')?.body).toEqual({ timezone: 'Australia/Sydney' })
  })

  it('shows the server\'s complaint under the phone field', async () => {
    serve((call) =>
      call.method === 'patch'
        ? { status: 422, data: { message: 'The phone has already been taken.', errors: { phone: ['The phone has already been taken.'] } } }
        : undefined,
    )
    const { wrapper } = await open()
    await settle()

    await wrapper.get('input[name=phone]').setValue('0899999999')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(wrapper.get('input[name=phone]').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('The phone has already been taken.')
  })

  it('does not send an empty name', async () => {
    const { calls } = serve()
    const { wrapper } = await open()
    await settle()

    await wrapper.get('input[name=name]').setValue('   ')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(calls.some((call) => call.method === 'patch')).toBe(false)
    expect(wrapper.text()).toContain('Enter your name.')
  })

  it('keeps a time zone the browser does not list selectable', async () => {
    serve(undefined, makeUser({ timezone: 'Asia/Rangoon' }))
    const { wrapper } = await open()
    await settle()

    const select = wrapper.findAll('select').find((s) => s.findAll('option').some((o) => o.element.value === 'Asia/Rangoon'))
    expect(select).toBeDefined()
    expect((select?.element as HTMLSelectElement).value).toBe('Asia/Rangoon')
  })
})

describe('ProfileView: photo', () => {
  it('previews a chosen picture and uploads it as the "avatar" field when saved', async () => {
    const { calls } = serve((call) =>
      call.url === '/me/avatar' ? { data: { data: makeUser({ avatar_thumb_url: 'https://cdn.example/t.webp', avatar_url: 'https://cdn.example/a.png' }) } } : undefined,
    )
    const { wrapper, pinia } = await open()
    await settle()

    await choose(wrapper, new File(['x'], 'me.png', { type: 'image/png' }))
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
    expect(wrapper.text()).toContain('Save photo')
    expect(calls.some((call) => call.url === '/me/avatar')).toBe(false)

    const save = wrapper.findAll('button').find((button) => button.text() === 'Save photo')
    await save?.trigger('click')
    await settle()

    const upload = calls.find((call) => call.url === '/me/avatar')
    expect(upload?.method).toBe('post')
    const form = upload?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect((form.get('avatar') as File).name).toBe('me.png')
    expect(useUiStore(pinia).toasts.map((toast) => toast.message)).toEqual(['Photo updated'])
    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example/t.webp')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('refuses a picture type the server would refuse, without uploading', async () => {
    const { calls } = serve()
    const { wrapper } = await open()
    await settle()

    await choose(wrapper, new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }))

    expect(wrapper.get('[role=alert]').text()).toBe('Choose a JPEG, PNG or WebP picture.')
    expect(wrapper.text()).not.toContain('Save photo')
    expect(calls.some((call) => call.url === '/me/avatar')).toBe(false)
  })

  it('lets the person cancel a chosen picture', async () => {
    serve()
    const { wrapper } = await open()
    await settle()
    await choose(wrapper, new File(['x'], 'me.webp', { type: 'image/webp' }))

    const cancel = wrapper.findAll('button').find((button) => button.text() === 'Cancel')
    await cancel?.trigger('click')

    expect(wrapper.text()).toContain('Change photo')
    expect(wrapper.text()).not.toContain('Save photo')
  })

  it('shows the server\'s reason when the upload is refused, and keeps the choice so it can be retried', async () => {
    serve((call) =>
      call.url === '/me/avatar'
        ? { status: 422, data: { message: 'The avatar field must be an image.', errors: { avatar: ['The avatar field must be an image.'] } } }
        : undefined,
    )
    const { wrapper } = await open()
    await settle()
    await choose(wrapper, new File(['x'], 'me.png', { type: 'image/png' }))

    await wrapper.findAll('button').find((button) => button.text() === 'Save photo')?.trigger('click')
    await settle()

    expect(wrapper.get('[role=alert]').text()).toBe('The avatar field must be an image.')
    expect(wrapper.text()).toContain('Save photo')
  })
})

describe('ProfileView: structure', () => {
  it('offers Settings as a labelled link (on phones it is not in the bottom bar)', async () => {
    serve()
    const { wrapper } = await open()
    await settle()

    expect(wrapper.get('a[href="/settings"]').attributes('aria-label')).toBe('Settings')
  })
})
