// Opening, sharing and saving what was sent in a chat. A file is downloaded into the app's cache (which the phone may
// clear when space runs low) and handed to the system share sheet, where the person picks what opens or keeps it. A
// photo only reaches the phone's photo library when the person taps "Save to photos".
import { Directory, File, Paths } from 'expo-file-system'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'

import { getMessage } from '@/api/messages'
import { useMessagesStore } from '@/stores/messages'
import type { Attachment, Message } from '@/types/chat'
import { linkExpired } from '@/utils/files'

/**
 * The message's attachment with links that still work. Links last 60 minutes and a chat can stay open longer: an
 * expired one is replaced by asking for the message again (the conversation then shows the fresh links too).
 */
export async function freshAttachment(message: Message): Promise<Attachment> {
  const attachment = message.attachment
  if (!attachment) throw new Error('This message has no attachment.')
  if (!linkExpired(attachment.url)) return attachment

  const fresh = await getMessage(message.id)
  useMessagesStore.getState().receiveUpdate(fresh)
  if (!fresh.attachment) throw new Error('The attachment is gone.')
  return fresh.attachment
}

/** Characters a file name cannot hold on one phone or another. */
const UNSAFE_IN_NAMES = /[\u0000-\u001f/\\:*?"<>|]+/g

/** A file name the phone's file system accepts, keeping what the person will recognise. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(UNSAFE_IN_NAMES, '_').trim().replace(/^\.+/, '')
  if (!cleaned) return 'file'
  if (cleaned.length <= 120) return cleaned
  const extension = /\.[A-Za-z0-9]{1,8}$/.exec(cleaned)?.[0] ?? ''
  return cleaned.slice(0, 120 - extension.length) + extension
}

/**
 * Downloads the attachment into the cache, under its own folder so two files with the same name do not collide.
 * A file already there with the right size is used again instead of downloading it twice.
 */
export async function downloadToCache(attachment: Attachment): Promise<File> {
  const folder = new Directory(Paths.cache, 'attachments', attachment.id)
  folder.create({ intermediates: true, idempotent: true })
  const target = new File(folder, safeFileName(attachment.original_name))
  if (target.exists && target.size === attachment.size) return target
  return File.downloadFileAsync(attachment.url, target, { idempotent: true })
}

/** Opens the system share sheet for a file from a chat: "Open with", "Save to Files", another app. */
export async function shareAttachment(message: Message): Promise<void> {
  const attachment = await freshAttachment(message)
  const file = await downloadToCache(attachment)
  await Sharing.shareAsync(file.uri, {
    dialogTitle: attachment.original_name,
    // On iOS the type would rename the file to match it; the file's own extension says enough there.
    ...(Platform.OS === 'android' ? { mimeType: attachment.mime_type } : {}),
  })
}

export type SaveResult = 'saved' | 'blocked'

/**
 * Saves a photo from a chat into the phone's photo library. Only permission to add photos is asked for (never to
 * read them); Android 13 and later need none at all.
 */
export async function savePhoto(message: Message): Promise<SaveResult> {
  const permission = await MediaLibrary.requestPermissionsAsync(true)
  if (!permission.granted) return 'blocked'
  const file = await downloadToCache(await freshAttachment(message))
  await MediaLibrary.Asset.create(file.uri)
  return 'saved'
}
