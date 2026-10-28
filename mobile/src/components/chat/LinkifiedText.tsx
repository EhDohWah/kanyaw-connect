import { memo, useMemo } from 'react'
import { Linking } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { linkify } from '@/utils/linkify'

/**
 * Message text with its web links tappable (they open in the browser). Everything else is plain text: nothing a
 * sender writes can become anything but text or an http(s) link. Long-pressing still reaches the message's actions.
 */
export const LinkifiedText = memo(function LinkifiedText({ text, own }: { text: string; own: boolean }) {
  const tokens = useMemo(() => linkify(text), [text])
  const color = own ? 'onPrimary' : 'text'
  return (
    <AppText color={color} selectable={false}>
      {tokens.map((token, index) =>
        token.type === 'text' ? (
          token.value
        ) : (
          <AppText
            key={index}
            color={own ? 'onPrimary' : 'primary'}
            style={{ textDecorationLine: 'underline' }}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(token.href)}
          >
            {token.value}
          </AppText>
        ),
      )}
    </AppText>
  )
})
