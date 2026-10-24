/** How long a finger must stay down before it counts as a long press. */
export const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 10

/**
 * Long-press for touch screens (a mouse has the hover toolbar instead). Spread the returned handlers onto an element.
 * Moving the finger more than a few pixels (scrolling) cancels it.
 */
export function useLongPress(onLongPress: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let startX = 0
  let startY = 0
  let fired = false

  function cancel(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    onPointerdown(event: PointerEvent): void {
      if (event.pointerType !== 'touch') return
      fired = false
      startX = event.clientX
      startY = event.clientY
      cancel()
      timer = setTimeout(() => {
        fired = true
        timer = undefined
        onLongPress()
      }, LONG_PRESS_MS)
    },
    onPointermove(event: PointerEvent): void {
      if (timer !== undefined && Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_TOLERANCE_PX) cancel()
    },
    onPointerup: cancel,
    onPointercancel: cancel,
    onPointerleave: cancel,
    /** The phone's own "copy / select" menu would open on top of ours after a long press. */
    onContextmenu(event: Event): void {
      if (fired) event.preventDefault()
    },
  }
}
