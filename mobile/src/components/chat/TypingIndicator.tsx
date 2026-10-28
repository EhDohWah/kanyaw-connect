import { useTranslation } from 'react-i18next'
import { StyleSheet } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { space } from '@/theme/tokens'

/** "Naw Paw is typing…". Always there and always the same height, so the box below does not jump. */
export function TypingIndicator({ names }: { names: string[] }) {
  const { t } = useTranslation()
  const [first, second] = names
  let text = ''
  if (first && names.length === 1) text = t('chat.typing.one', { name: first })
  else if (first && second && names.length === 2) text = t('chat.typing.two', { first, second })
  else if (names.length > 2) text = t('chat.typing.many')

  return (
    <AppText size="xs" color="textMuted" numberOfLines={1} style={styles.line} accessibilityLiveRegion="polite">
      {text}
    </AppText>
  )
}

const styles = StyleSheet.create({ line: { minHeight: 22, paddingHorizontal: space[4] } })
