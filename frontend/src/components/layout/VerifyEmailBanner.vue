<script lang="ts">
/** Where "Hide for now" is remembered for the session (the user's id, so another person on this browser still sees it). */
export const HIDE_KEY = 'kc.verifyReminderHidden'
/** At most one profile reload this often when the tab comes back into view. */
export const RECHECK_MS = 30_000
</script>

<script setup lang="ts">
import { MailCheck, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import * as accountApi from '@/api/account'
import { isApiError } from '@/api/errors'
import { useAuthStore } from '@/stores/auth'
import { errorMessage } from '@/utils/errorMessage'

/**
 * A reminder while the email address is not verified, with "Send again". Nothing in the app waits for it. Hidden for
 * the rest of the session when dismissed (Settings keeps the button). When the person comes back to the tab (having
 * clicked the link on their phone, say), the profile is loaded again so the reminder goes away by itself.
 */

const { t } = useI18n()
const auth = useAuthStore()

function hiddenFor(): string | null {
  try {
    return window.sessionStorage.getItem(HIDE_KEY)
  } catch {
    return null
  }
}

const hidden = ref(hiddenFor() === auth.user?.id)
const sending = ref(false)
const sent = ref(false)
const problem = ref('')

const show = computed(() => auth.user !== null && auth.user.email_verified_at === null && hidden.value !== true)

async function send(): Promise<void> {
  sending.value = true
  problem.value = ''
  try {
    const { verified } = await accountApi.sendVerificationEmail()
    if (verified) await auth.refreshUser()
    else sent.value = true
  } catch (error) {
    if (!isApiError(error)) throw error
    problem.value = errorMessage(error, t)
  } finally {
    sending.value = false
  }
}

function hide(): void {
  hidden.value = true
  try {
    if (auth.user) window.sessionStorage.setItem(HIDE_KEY, auth.user.id)
  } catch {
    // private window: hidden until the page is reloaded
  }
}

let lastCheck = Date.now()
function recheck(): void {
  if (document.visibilityState !== 'visible' || !show.value || Date.now() - lastCheck < RECHECK_MS) return
  lastCheck = Date.now()
  void auth.refreshUser()
}

onMounted(() => document.addEventListener('visibilitychange', recheck))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', recheck))
</script>

<template>
  <div v-if="show" class="flex items-start gap-3 border-b border-border bg-primary-soft px-4 py-2 text-sm text-text" role="region" :aria-label="t('account.banner.label')">
    <MailCheck class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
      <p class="min-w-0">{{ t('account.banner.text', { email: auth.user?.email ?? '' }) }}</p>
      <p v-if="sent" role="status">{{ t('account.banner.sent') }}</p>
      <button
        v-else
        type="button"
        class="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-2 hover:text-primary-hover disabled:opacity-60"
        :disabled="sending"
        :aria-busy="sending || undefined"
        @click="send"
      >
        {{ sending ? t('account.banner.sending') : t('account.banner.send') }}
      </button>
      <p v-if="problem" class="text-danger" role="alert">{{ problem }}</p>
    </div>
    <button
      type="button"
      class="-my-1 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface hover:text-text"
      :aria-label="t('account.banner.hide')"
      @click="hide"
    >
      <X class="size-4" aria-hidden="true" />
    </button>
  </div>
</template>
