// Ported from frontend/src/components/chat/MessageMedia.vue: a photo (tap to open it full screen), a file card (tap to
// open or share it), or a voice message. Pictures load at thumbnail size; the full picture only in the viewer.
import { Image } from 'expo-image'
import { FileText, ImageOff } from 'lucide-react-native'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'

import { VoicePlayer } from '@/components/chat/VoicePlayer'
import { AppText } from '@/components/common/AppText'
import type { TimelineMessage } from '@/types/chat'
import { colors, radius, space } from '@/theme/tokens'
import { formatBytes } from '@/utils/files'

/** The longest side of a photo in the conversation. */
export const PHOTO_SIZE = 220

export interface MessageMediaProps {
  message: TimelineMessage
  own: boolean
  /** 0–100 while the file is going up; null otherwise. */
  progress: number | null
  onOpenImage(messageId: string): void
  onOpenFile(messageId: string): void
  onExpired(messageId: string): void
  style?: StyleProp<ViewStyle>
}

export const MessageMedia = memo(function MessageMedia({
  message,
  own,
  progress,
  onOpenImage,
  onOpenFile,
  onExpired,
  style,
}: MessageMediaProps) {
  const { t } = useTranslation()
  const attachment = message.attachment
  // The address that failed, so a fresh link (a new address) is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (!attachment) return null

  if (message.type === 'image') {
    const src = attachment.thumbnail_url ?? attachment.url
    const failed = failedSrc === src
    return (
      <Pressable
        onPress={() => onOpenImage(message.id)}
        disabled={failed || message.pending !== undefined}
        accessibilityRole="imagebutton"
        accessibilityLabel={t('message.openPhoto')}
        style={[styles.photo, style]}
      >
        {failed ? (
          <View style={styles.photoFallback}>
            <ImageOff size={28} color={colors.textMuted} />
            <AppText size="xs" color="textMuted">
              {t('message.photoUnavailable')}
            </AppText>
          </View>
        ) : (
          <Image
            source={src}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={attachment.id}
            accessible={false}
            onError={() => {
              setFailedSrc(src)
              // Signed links last an hour: ask for fresh ones (the store does that at most every few minutes).
              if (!message.pending) onExpired(message.id)
            }}
          />
        )}
        {progress !== null && progress < 100 ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${progress}%` }]} />
          </View>
        ) : null}
      </Pressable>
    )
  }

  if (message.type === 'voice') {
    return <VoicePlayer message={message} own={own} style={style} onExpired={onExpired} />
  }

  return (
    <Pressable
      onPress={() => onOpenFile(message.id)}
      disabled={message.pending !== undefined}
      accessibilityRole="button"
      accessibilityLabel={t('message.download', { name: attachment.original_name })}
      style={[styles.file, own ? styles.fileOwn : styles.fileOther, style]}
    >
      <FileText size={28} color={own ? colors.onPrimary : colors.primary} />
      <View style={styles.fileText}>
        <AppText weight={500} color={own ? 'onPrimary' : 'text'} numberOfLines={2}>
          {attachment.original_name}
        </AppText>
        <AppText size="xs" color={own ? 'onPrimary' : 'textMuted'}>
          {progress !== null && progress < 100
            ? t('message.uploading', { percent: progress })
            : formatBytes(attachment.size)}
        </AppText>
      </View>
    </Pressable>
  )
})

const styles = StyleSheet.create({
  photo: {
    width: PHOTO_SIZE,
    height: PHOTO_SIZE,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  photoFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space[1] },
  progressTrack: {
    position: 'absolute',
    left: space[2],
    right: space[2],
    bottom: space[2],
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  progressBar: { height: 4, borderRadius: 2, backgroundColor: colors.onPrimary },
  file: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    padding: space[2],
    borderRadius: radius.lg,
    minWidth: 200,
  },
  fileOwn: { backgroundColor: colors.primaryHover },
  fileOther: { backgroundColor: colors.bg },
  fileText: { flexShrink: 1, gap: 2 },
})
