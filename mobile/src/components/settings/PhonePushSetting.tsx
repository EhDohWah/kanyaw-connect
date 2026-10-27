import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AppState, Linking, StyleSheet, Switch, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { AppText } from '@/components/common/AppText'
import { Button } from '@/components/common/Button'
import { Notice } from '@/components/common/Notice'
import { disablePhonePush, enablePhonePush, phonePushState, type PhonePushState } from '@/push/phonePush'
import { colors, space, TOUCH_TARGET } from '@/theme/tokens'
import { errorMessage } from '@/utils/errorMessage'

type Busy = 'checking' | 'turningOn' | 'turningOff' | null

/** "Notifications on this phone": the switch registers or removes this phone's push token (see push/phonePush). */
export function PhonePushSetting({ userId }: { userId: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<PhonePushState>('off')
  const [busy, setBusy] = useState<Busy>('checking')
  /** Why turning it on or off failed: the server's own answer, or ours when the phone could not get a token. */
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    const check = (): void => {
      void phonePushState(userId)
        .catch((): PhonePushState => 'off')
        .then((found) => {
          if (!current) return
          setState(found)
          setBusy((was) => (was === 'checking' ? null : was))
        })
    }
    check()
    // Coming back from the phone's settings (or anywhere else): the permission may have changed there.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check()
    })
    return () => {
      current = false
      subscription.remove()
    }
  }, [userId])

  async function toggle(on: boolean): Promise<void> {
    setFailed(null)
    setBusy(on ? 'turningOn' : 'turningOff')
    try {
      if (on) setState(await enablePhonePush(userId))
      else {
        await disablePhonePush()
        setState('off')
      }
    } catch (error) {
      setFailed(isApiError(error) ? errorMessage(error, t) : t('settings.phonePush.failed'))
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null || state === 'blocked'
  const status = busy === 'checking' ? t('settings.push.checking') : busy ? t(`settings.push.${busy}`) : null

  return (
    <View style={styles.section}>
      <View style={styles.row}>
        <View style={styles.text}>
          <AppText weight={500}>{t('settings.phonePush.label')}</AppText>
          <AppText size="sm" color="textMuted">
            {status ?? t('settings.phonePush.hint')}
          </AppText>
        </View>
        <Switch
          testID="phone-push-switch"
          accessibilityLabel={t('settings.phonePush.label')}
          accessibilityHint={t('settings.phonePush.hint')}
          value={state === 'on'}
          disabled={disabled}
          // Switch does not pass these to TalkBack and VoiceOver by itself.
          accessibilityState={{ checked: state === 'on', disabled, busy: busy !== null }}
          onValueChange={(on) => void toggle(on)}
          trackColor={{ true: colors.primary, false: colors.border }}
          style={styles.switch}
        />
      </View>
      {state === 'blocked' ? (
        <>
          <Notice text={t('settings.phonePush.blocked')} />
          <Button
            label={t('settings.phonePush.openSettings')}
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        </>
      ) : null}
      {failed ? <Notice tone="error" text={failed} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: TOUCH_TARGET },
  text: { flex: 1, gap: space[1] },
  switch: { minHeight: TOUCH_TARGET },
})
