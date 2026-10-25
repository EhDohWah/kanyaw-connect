// Replaces frontend/src/utils/deviceName.ts (which reads the browser's user agent).
import * as Device from 'expo-device'
import { Platform } from 'react-native'

/** A readable name for this phone ("Pixel 7 (Android)"), sent at login so each token can be told apart later. */
export function describeDevice(model: string | null = Device.modelName, os: string = Platform.OS): string {
  const system = os === 'ios' ? 'iOS' : os === 'android' ? 'Android' : os
  return `${model?.trim() || 'Phone'} (${system})`
}
