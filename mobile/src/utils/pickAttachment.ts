// The three ways to attach something on a phone. The photo library and the file picker are system screens that hand
// over only what the person chooses, so they need no permission. The camera does: the app says why first, then the
// phone asks, and a camera that was refused for good is explained with a way to the phone's settings.
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import type { TFunction } from 'i18next'
import { Alert, Linking } from 'react-native'

import { MAX_ATTACHMENT_BYTES } from '@/api/attachments'
import type { LocalFile } from '@/types/chat'
import { AttachError, prepareChatImage } from '@/utils/chatImage'

export type AttachSource = 'library' | 'camera' | 'file'

/** Lets the person choose or take something to send. Resolves to null when they change their mind. */
export async function pickAttachment(source: AttachSource, t: TFunction): Promise<LocalFile | null> {
  if (source === 'file') return pickFile()

  if (source === 'camera' && !(await cameraAllowed(t))) return null
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 }
  const picked =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options)
  const asset = picked.canceled ? undefined : picked.assets[0]
  return asset ? prepareChatImage(asset) : null
}

async function pickFile(): Promise<LocalFile | null> {
  // Copied into the app's cache, so the upload (and a retry after a failed send) can still read it later.
  const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false })
  const asset = picked.canceled ? undefined : picked.assets[0]
  if (!asset) return null
  if ((asset.size ?? 0) > MAX_ATTACHMENT_BYTES) throw new AttachError('too-big')
  return {
    uri: asset.uri,
    name: asset.name,
    mimeType: asset.mimeType || 'application/octet-stream',
    size: asset.size ?? null,
  }
}

/** Two buttons; resolves to true when the second (the one that goes ahead) is chosen. */
function ask(title: string, text: string, no: string, yes: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      text,
      [
        { text: no, style: 'cancel', onPress: () => resolve(false) },
        { text: yes, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    )
  })
}

/**
 * Whether the camera may be used, asking only now that the person wants to take a photo. When they say no to the
 * phone's own question, that answer stands: nothing more is shown until they try again.
 */
async function cameraAllowed(t: TFunction): Promise<boolean> {
  const current = await ImagePicker.getCameraPermissionsAsync()
  if (current.granted) return true

  if (current.canAskAgain) {
    const go = await ask(
      t('chat.attach.cameraTitle'),
      t('chat.attach.cameraReason'),
      t('common.notNow'),
      t('common.continue'),
    )
    if (!go) return false
    return (await ImagePicker.requestCameraPermissionsAsync()).granted
  }

  const open = await ask(
    t('chat.attach.cameraTitle'),
    t('chat.attach.cameraBlocked'),
    t('common.notNow'),
    t('common.openSettings'),
  )
  if (open) void Linking.openSettings()
  return false
}
