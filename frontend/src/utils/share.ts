import { copyText } from '@/utils/messageActions'

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * "Share": the phone's own share sheet where the browser has one; otherwise the link is copied to the clipboard, and the
 * caller says so (`copied`). Closing the share sheet without choosing is not an error (`cancelled`).
 */
export async function shareLink(data: { title: string; text?: string; url: string }): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share(data)
      return 'shared'
    } catch (problem) {
      if (problem instanceof DOMException && problem.name === 'AbortError') return 'cancelled'
      // Any other refusal (not allowed here, not supported for this data): copy the link instead.
    }
  }

  return (await copyText(data.url)) ? 'copied' : 'failed'
}
