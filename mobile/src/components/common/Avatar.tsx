import { Image } from 'expo-image'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'

import { AppText } from '@/components/common/AppText'
import { AVATAR_COLORS } from '@/theme/tokens'
import { avatarColorIndex, initials } from '@/utils/initials'

const SIZES = { sm: 32, md: 48, lg: 96 } as const

export interface AvatarProps {
  name: string
  /** The person's or chat's id: the same one always gets the same colour. */
  seed: string
  src?: string | null
  size?: keyof typeof SIZES
}

/**
 * A photo, or coloured initials when there is none or it cannot be loaded (as on the web). The initials also show
 * while the photo loads, so a slow or unreachable address never leaves an empty space. Decorative: the name is always
 * shown beside it.
 */
export function Avatar({ name, seed, src, size = 'md' }: AvatarProps) {
  const edge = SIZES[size]
  const frame = { width: edge, height: edge, borderRadius: edge / 2 }
  // Per address, so a new photo (a changed one) is loaded and judged again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)

  const tryPhoto = Boolean(src) && src !== failedSrc
  const showInitials = !tryPhoto || src !== loadedSrc

  return (
    <View style={frame} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {showInitials ? (
        <View
          testID="avatar-initials"
          style={[styles.initials, frame, { backgroundColor: AVATAR_COLORS[avatarColorIndex(seed) - 1] }]}
        >
          <AppText
            weight={600}
            color="onPrimary"
            maxFontSizeMultiplier={1}
            style={{ fontSize: edge * 0.38, lineHeight: edge * 0.6 }}
          >
            {initials(name)}
          </AppText>
        </View>
      ) : null}
      {tryPhoto && src ? (
        <Image
          source={src}
          style={[StyleSheet.absoluteFill, frame]}
          contentFit="cover"
          cachePolicy="memory-disk"
          accessible={false}
          testID="avatar-photo"
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  initials: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
})
