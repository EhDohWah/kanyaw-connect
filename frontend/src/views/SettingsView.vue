<script setup lang="ts">
import { LogOut } from 'lucide-vue-next'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/common/BaseButton.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

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

    <section class="flex flex-col gap-4 rounded-xl border border-border p-5" :aria-label="t('settings.account')">
      <h2 class="font-semibold">{{ t('settings.account') }}</h2>

      <div v-if="auth.user" class="flex items-center gap-3">
        <UserAvatar :name="auth.user.name" :seed="auth.user.id" :src="auth.user.avatar_thumb_url" />
        <div class="min-w-0">
          <p class="truncate font-medium">{{ t('settings.signedInAs', { name: auth.user.name }) }}</p>
          <p class="truncate text-sm text-text-muted">{{ auth.user.email }}</p>
        </div>
      </div>

      <BaseButton variant="secondary" :loading="signingOut" class="self-start" @click="signOut">
        <LogOut class="size-4" aria-hidden="true" />
        {{ signingOut ? t('settings.signingOut') : t('settings.signOut') }}
      </BaseButton>
    </section>
  </div>
</template>
