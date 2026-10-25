<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import * as accountApi from '@/api/account'
import { isApiError } from '@/api/errors'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseInput from '@/components/common/BaseInput.vue'
import BaseSwitch from '@/components/common/BaseSwitch.vue'
import Skeleton from '@/components/common/Skeleton.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { browserPush } from '@/push/browser'
import { useAuthStore } from '@/stores/auth'
import { usePushStore } from '@/stores/push'
import { errorMessage } from '@/utils/errorMessage'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const push = usePushStore()

/** The sentence for something that went wrong: the server's (translated where we can), or the browser's. */
function problemText(error: unknown): string {
  if (!error) return ''
  return isApiError(error) ? errorMessage(error, t) : t('settings.push.browserFailed')
}

/* ------------------------------------------------------------------------------- notifications --- */

const needsHomeScreen = browserPush().needsHomeScreen()
const pushProblem = computed(() => problemText(push.error))
const pushReady = computed(() => push.status === 'on' || push.status === 'off' || push.status === 'blocked')

function togglePush(on: boolean): void {
  void (on ? push.turnOn() : push.turnOff())
}

// Notifications can be allowed (or blocked) in the browser's settings while this page is open, or while the person is
// away from it: look again then.
function recheck(): void {
  if (document.visibilityState === 'visible' && !push.busy) void push.check()
}
let stopWatching: () => void = () => undefined

onMounted(() => {
  void push.check()
  document.addEventListener('visibilitychange', recheck)
  stopWatching = browserPush().onPermissionChange(recheck)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', recheck)
  stopWatching()
})

/* --------------------------------------------------------------------------------- data saver --- */

const dataSaver = computed(() => auth.user?.settings.data_saver === true)
const savingDataSaver = ref(false)
const dataSaverError = ref<unknown>(null)

async function setDataSaver(on: boolean): Promise<void> {
  savingDataSaver.value = true
  dataSaverError.value = null
  try {
    await auth.saveSettings({ data_saver: on })
  } catch (error) {
    dataSaverError.value = error
  } finally {
    savingDataSaver.value = false
  }
}

/* -------------------------------------------------------------------------------------- calls --- */

/** Both on unless switched off: a call should ring. */
const ringtone = computed(() => auth.user?.settings.call_ringtone !== false)
const vibrate = computed(() => auth.user?.settings.call_vibrate !== false)
const savingCalls = ref(false)
const callsError = ref<unknown>(null)

async function setCallSetting(key: 'call_ringtone' | 'call_vibrate', on: boolean): Promise<void> {
  savingCalls.value = true
  callsError.value = null
  try {
    await auth.saveSettings({ [key]: on })
  } catch (error) {
    callsError.value = error
  } finally {
    savingCalls.value = false
  }
}

/* ----------------------------------------------------------------------------------- password --- */

const passwordForm = reactive({ current_password: '', password: '', password_confirmation: '' })
const passwordErrors = reactive({ current_password: '', password: '', password_confirmation: '' })
const passwordProblem = ref('')
const changingPassword = ref(false)
const passwordChanged = ref(false)

function validatePassword(): boolean {
  passwordErrors.current_password = passwordForm.current_password ? '' : t('settings.password.currentRequired')
  passwordErrors.password = passwordForm.password.length >= 8 ? '' : t('auth.passwordTooShort')
  passwordErrors.password_confirmation = passwordForm.password_confirmation === passwordForm.password ? '' : t('auth.passwordMismatch')
  return !Object.values(passwordErrors).some(Boolean)
}

async function changePassword(): Promise<void> {
  passwordProblem.value = ''
  passwordChanged.value = false
  if (!validatePassword()) return

  changingPassword.value = true
  try {
    await accountApi.changePassword({ ...passwordForm })
    passwordForm.current_password = passwordForm.password = passwordForm.password_confirmation = ''
    passwordChanged.value = true
  } catch (error) {
    if (!isApiError(error)) throw error
    if (error.status === 422) {
      for (const key of Object.keys(passwordErrors) as (keyof typeof passwordErrors)[]) passwordErrors[key] = error.fieldError(key) ?? ''
      if (!Object.values(passwordErrors).some(Boolean)) passwordProblem.value = error.message
    } else passwordProblem.value = errorMessage(error, t)
  } finally {
    changingPassword.value = false
  }
}

/* ------------------------------------------------------------------------------------ account --- */

const sendingVerification = ref(false)
const verificationSent = ref(false)
const verificationProblem = ref('')

async function sendVerification(): Promise<void> {
  sendingVerification.value = true
  verificationProblem.value = ''
  try {
    const { verified } = await accountApi.sendVerificationEmail()
    if (verified) await auth.refreshUser()
    else verificationSent.value = true
  } catch (error) {
    if (!isApiError(error)) throw error
    verificationProblem.value = errorMessage(error, t)
  } finally {
    sendingVerification.value = false
  }
}

const signingOut = ref(false)

async function signOut(): Promise<void> {
  signingOut.value = true
  try {
    await auth.logout()
    await router.replace({ name: 'login' })
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex max-w-xl flex-col gap-6 p-4 md:p-8">
    <h1 class="text-2xl font-semibold">{{ t('settings.title') }}</h1>

    <!-- Hidden when the server has push switched off. -->
    <section
      v-if="push.status !== 'unavailable'"
      class="flex flex-col gap-3 rounded-xl border border-border p-5"
      aria-labelledby="settings-notifications"
    >
      <h2 id="settings-notifications" class="font-semibold">{{ t('settings.notifications') }}</h2>

      <div v-if="push.status === 'idle' || push.status === 'checking'" class="flex flex-col gap-2" role="status">
        <Skeleton class="h-5 w-2/3" />
        <Skeleton class="h-4 w-full" />
        <span class="sr-only">{{ t('settings.push.checking') }}</span>
      </div>

      <p v-else-if="push.status === 'unsupported'" class="text-sm text-text">
        {{ needsHomeScreen ? t('settings.push.homeScreen') : t('settings.push.unsupported') }}
      </p>

      <div v-else-if="push.status === 'failed'" class="flex flex-col items-start gap-3">
        <p class="text-sm text-text" role="alert">{{ pushProblem }}</p>
        <BaseButton variant="secondary" @click="push.check()">{{ t('common.retry') }}</BaseButton>
      </div>

      <template v-else-if="pushReady">
        <BaseSwitch
          :model-value="push.status === 'on'"
          :disabled="push.busy || push.status === 'blocked'"
          :label="t('settings.push.label')"
          :hint="t('settings.push.hint')"
          @update:model-value="togglePush"
        />
        <p v-if="push.status === 'blocked'" class="text-sm text-text">{{ t('settings.push.blocked') }}</p>
        <p v-if="push.busy" class="text-sm text-text-muted" role="status">
          {{ push.status === 'on' ? t('settings.push.turningOff') : t('settings.push.turningOn') }}
        </p>
        <p v-if="pushProblem" class="text-sm text-danger" role="alert">{{ pushProblem }}</p>
      </template>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-border p-5" aria-labelledby="settings-calls">
      <h2 id="settings-calls" class="font-semibold">{{ t('settings.calls.title') }}</h2>
      <BaseSwitch
        :model-value="ringtone"
        :disabled="savingCalls || !auth.user"
        :label="t('settings.calls.ringtone')"
        :hint="t('settings.calls.ringtoneHint')"
        @update:model-value="setCallSetting('call_ringtone', $event)"
      />
      <BaseSwitch
        :model-value="vibrate"
        :disabled="savingCalls || !auth.user"
        :label="t('settings.calls.vibrate')"
        :hint="t('settings.calls.vibrateHint')"
        @update:model-value="setCallSetting('call_vibrate', $event)"
      />
      <p v-if="callsError" class="text-sm text-danger" role="alert">{{ problemText(callsError) }}</p>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-border p-5" aria-labelledby="settings-meetings">
      <h2 id="settings-meetings" class="font-semibold">{{ t('settings.meetings') }}</h2>
      <BaseSwitch
        :model-value="dataSaver"
        :disabled="savingDataSaver || !auth.user"
        :label="t('settings.dataSaver')"
        :hint="t('settings.dataSaverHint')"
        @update:model-value="setDataSaver"
      />
      <p v-if="dataSaverError" class="text-sm text-danger" role="alert">{{ problemText(dataSaverError) }}</p>
    </section>

    <section class="flex flex-col gap-3 rounded-xl border border-border p-5" aria-labelledby="settings-password">
      <h2 id="settings-password" class="font-semibold">{{ t('settings.password.title') }}</h2>
      <p class="text-sm text-text-muted">{{ t('settings.password.hint') }}</p>
      <form class="flex flex-col gap-4" novalidate @submit.prevent="changePassword">
        <!-- For password managers: the account whose password this is. -->
        <input type="email" name="email" autocomplete="username" :value="auth.user?.email ?? ''" class="sr-only" tabindex="-1" aria-hidden="true" readonly />
        <BaseInput
          v-model="passwordForm.current_password"
          :label="t('settings.password.current')"
          :error="passwordErrors.current_password"
          type="password"
          name="current_password"
          autocomplete="current-password"
          required
        />
        <BaseInput
          v-model="passwordForm.password"
          :label="t('account.newPassword')"
          :hint="t('auth.passwordHint')"
          :error="passwordErrors.password"
          type="password"
          name="password"
          autocomplete="new-password"
          required
        />
        <BaseInput
          v-model="passwordForm.password_confirmation"
          :label="t('account.confirmNewPassword')"
          :error="passwordErrors.password_confirmation"
          type="password"
          name="password_confirmation"
          autocomplete="new-password"
          required
        />
        <p v-if="passwordProblem" class="text-sm text-danger" role="alert">{{ passwordProblem }}</p>
        <p v-if="passwordChanged" class="text-sm text-text" role="status">{{ t('settings.password.done') }}</p>
        <BaseButton type="submit" variant="secondary" class="self-start" :loading="changingPassword">
          {{ changingPassword ? t('account.saving') : t('settings.password.submit') }}
        </BaseButton>
      </form>
    </section>

    <section class="flex flex-col gap-4 rounded-xl border border-border p-5" aria-labelledby="settings-account">
      <h2 id="settings-account" class="font-semibold">{{ t('settings.account') }}</h2>

      <div v-if="auth.user" class="flex items-center gap-3">
        <UserAvatar :name="auth.user.name" :seed="auth.user.id" :src="auth.user.avatar_thumb_url" />
        <div class="min-w-0">
          <p class="truncate font-medium">{{ t('settings.signedInAs', { name: auth.user.name }) }}</p>
          <p class="truncate text-sm text-text-muted">{{ auth.user.email }}</p>
          <p class="text-sm" :class="auth.user.email_verified_at ? 'text-text-muted' : 'text-text'">
            {{ auth.user.email_verified_at ? t('settings.email.verified') : t('settings.email.notVerified') }}
          </p>
        </div>
      </div>

      <div v-if="auth.user && !auth.user.email_verified_at" class="flex flex-col items-start gap-2">
        <p v-if="verificationSent" class="text-sm text-text" role="status">{{ t('settings.email.sent', { email: auth.user.email }) }}</p>
        <BaseButton v-else variant="secondary" :loading="sendingVerification" @click="sendVerification">{{ t('settings.email.send') }}</BaseButton>
        <p v-if="verificationProblem" class="text-sm text-danger" role="alert">{{ verificationProblem }}</p>
      </div>

      <BaseButton variant="secondary" :loading="signingOut" class="self-start" @click="signOut">
        <LogOut class="size-4" aria-hidden="true" />
        {{ signingOut ? t('settings.signingOut') : t('settings.signOut') }}
      </BaseButton>
    </section>
  </div>
</template>
