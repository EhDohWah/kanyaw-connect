import * as ImagePicker from 'expo-image-picker'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { AppText } from '@/components/common/AppText'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { useAuthStore } from '@/stores/auth'
import { space } from '@/theme/tokens'
import { AvatarError, prepareAvatar } from '@/utils/avatar'
import { errorMessage } from '@/utils/errorMessage'

const PROBLEM_KEYS = {
  type: 'profile.photoType',
  'too-big': 'profile.photoTooBig',
  unreadable: 'profile.photoUnreadable',
} as const

/**
 * The profile photo and "Change photo". The system photo picker needs no permission on Android 13+ or iOS (it only
 * hands over the photo you choose), so nothing is asked for up front. The photo is shrunk on the phone before upload.
 */
export function AvatarEditor() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const uploadAvatar = useAuthStore((state) => state.uploadAvatar)
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  async function choose(): Promise<void> {
    setMessage(null)
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    })
    const asset = picked.canceled ? undefined : picked.assets[0]
    if (!asset) return

    setProgress(0)
    try {
      const file = await prepareAvatar(asset)
      await uploadAvatar(file, setProgress)
      setMessage({ text: t('profile.photoUpdated'), error: false })
    } catch (error) {
      if (error instanceof AvatarError) setMessage({ text: t(PROBLEM_KEYS[error.problem]), error: true })
      else if (isApiError(error))
        setMessage({
          text: error.status === 422 ? (error.fieldError('avatar') ?? error.message) : errorMessage(error, t),
          error: true,
        })
      else throw error
    } finally {
      setProgress(null)
    }
  }

  if (!user) return null
  return (
    <View style={styles.wrap}>
      <Avatar name={user.name} seed={user.id} src={user.avatar_url} size="lg" />
      <Button
        label={t('profile.changePhoto')}
        variant="secondary"
        loading={progress !== null}
        loadingLabel={t('profile.uploading', { percent: progress ?? 0 })}
        onPress={() => void choose()}
      />
      {message ? (
        <AppText
          size="sm"
          color={message.error ? 'danger' : 'success'}
          accessibilityLiveRegion="polite"
          style={styles.center}
        >
          {message.text}
        </AppText>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[3] },
  center: { textAlign: 'center' },
})
