import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { AppText } from '@/components/common/AppText'
import { AvatarEditor } from '@/components/common/AvatarEditor'
import { Button } from '@/components/common/Button'
import { LanguagePicker } from '@/components/common/LanguagePicker'
import { Notice } from '@/components/common/Notice'
import { Screen } from '@/components/common/Screen'
import { TextField } from '@/components/common/TextField'
import { TimezonePicker } from '@/components/common/TimezonePicker'
import { useAuthStore } from '@/stores/auth'
import type { ProfilePatch } from '@/types/user'
import { space } from '@/theme/tokens'
import { errorMessage } from '@/utils/errorMessage'

const NO_ERRORS = { name: '', phone: '', timezone: '' }

// Ported from frontend/src/views/ProfileView.vue.
export default function ProfileScreen() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const updateProfile = useAuthStore((state) => state.updateProfile)

  const [form, setForm] = useState(() => ({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    timezone: user?.timezone ?? 'Asia/Bangkok',
  }))
  const [errors, setErrors] = useState(NO_ERRORS)
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'success' } | null>(null)
  const [saving, setSaving] = useState(false)

  if (!user) return null

  const changes: ProfilePatch = {}
  if (form.name.trim() !== user.name) changes.name = form.name.trim()
  if (form.phone.trim() !== (user.phone ?? '')) changes.phone = form.phone.trim() === '' ? null : form.phone.trim()
  if (form.timezone !== user.timezone) changes.timezone = form.timezone
  const dirty = Object.keys(changes).length > 0

  async function save(): Promise<void> {
    setNotice(null)
    setErrors(NO_ERRORS)
    if (!form.name.trim()) {
      setErrors({ ...NO_ERRORS, name: t('auth.nameRequired') })
      return
    }

    setSaving(true)
    try {
      const saved = await updateProfile(changes)
      // Show what the server kept (it may tidy a value), so "Save changes" does not stay on for no reason.
      setForm({ name: saved.name, phone: saved.phone ?? '', timezone: saved.timezone })
      setNotice({ text: t('profile.saved'), tone: 'success' })
    } catch (error) {
      if (!isApiError(error)) throw error
      if (error.status === 422) {
        const next = {
          name: error.fieldError('name') ?? '',
          phone: error.fieldError('phone') ?? '',
          timezone: error.fieldError('timezone') ?? '',
        }
        setErrors(next)
        if (!next.name && !next.phone && !next.timezone) setNotice({ text: error.message, tone: 'error' })
      } else {
        setNotice({ text: errorMessage(error, t), tone: 'error' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Screen>
      <AvatarEditor />

      <TextField
        label={t('profile.name')}
        value={form.name}
        onChangeText={(name) => setForm({ ...form, name })}
        error={errors.name}
        autoComplete="name"
      />
      <View style={styles.field}>
        <AppText size="sm" weight={500}>
          {t('profile.email')}
        </AppText>
        <AppText>{user.email}</AppText>
        <AppText size="sm" color="textMuted">
          {t('profile.emailLocked')}
        </AppText>
      </View>
      <TextField
        label={`${t('profile.phone')} (${t('common.optional')})`}
        value={form.phone}
        onChangeText={(phone) => setForm({ ...form, phone })}
        error={errors.phone}
        hint={t('auth.phoneHint')}
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <TimezonePicker
        label={t('profile.timezone')}
        hint={t('profile.timezoneHint')}
        error={errors.timezone}
        value={form.timezone}
        onChange={(timezone) => setForm({ ...form, timezone })}
      />

      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}
      <Button
        label={t('common.save')}
        loadingLabel={t('common.saving')}
        loading={saving}
        disabled={!dirty}
        onPress={() => void save()}
      />

      <View style={styles.field}>
        <AppText size="sm" weight={500} accessibilityRole="header">
          {t('profile.language')}
        </AppText>
        <LanguagePicker onError={(text) => setNotice({ text, tone: 'error' })} />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({ field: { gap: space[1] } })
