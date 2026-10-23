import { describe, expect, it } from 'vitest'

import { focusableElements, trapTab } from '@/utils/focus'

function dialog(): HTMLElement {
  const root = document.createElement('div')
  root.tabIndex = -1
  root.innerHTML = `
    <button id="a">A</button>
    <button id="disabled" disabled>X</button>
    <a id="b" href="/x">B</a>
    <input id="hidden" type="hidden" />
    <div id="skip" tabindex="-1">skip</div>
    <input id="c" />
  `
  document.body.append(root)
  return root
}

function tab(shift = false): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, cancelable: true })
}

describe('focusableElements', () => {
  it('lists what Tab can reach, in order', () => {
    expect(focusableElements(dialog()).map((el) => el.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('trapTab', () => {
  it('wraps from the last element to the first', () => {
    const root = dialog()
    root.querySelector<HTMLElement>('#c')?.focus()
    const event = tab()

    trapTab(event, root)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('a')
  })

  it('wraps from the first element to the last with Shift+Tab', () => {
    const root = dialog()
    root.querySelector<HTMLElement>('#a')?.focus()
    const event = tab(true)

    trapTab(event, root)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement?.id).toBe('c')
  })

  it('pulls focus back in when it is outside the dialog', () => {
    const root = dialog()
    const outside = document.createElement('button')
    document.body.append(outside)
    outside.focus()

    trapTab(tab(), root)

    expect(document.activeElement?.id).toBe('a')
  })

  it('leaves Tab alone in the middle of the dialog', () => {
    const root = dialog()
    root.querySelector<HTMLElement>('#b')?.focus()
    const event = tab()

    trapTab(event, root)

    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores other keys', () => {
    const root = dialog()
    root.querySelector<HTMLElement>('#c')?.focus()
    const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true })

    trapTab(event, root)

    expect(event.defaultPrevented).toBe(false)
  })

  it('keeps focus on the dialog itself when there is nothing to focus', () => {
    const root = document.createElement('div')
    root.tabIndex = -1
    document.body.append(root)
    const event = tab()

    trapTab(event, root)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(root)
  })
})
