import {
  createLocalAudioTrack,
  createLocalVideoTrack,
  MediaDeviceFailure,
  Room,
  VideoPresets,
  type LocalAudioTrack,
  type LocalVideoTrack,
} from 'livekit-client'

/**
 * The camera and microphone on this device, through LiveKit (so the tracks made for the preview can be sent into the call
 * as they are, without asking the browser a second time). Kept in one module so tests can stand in for it.
 */

/** The camera is sent at 360p: enough for a face, and kind to slow mobile data (VideoPresets.h360). */
export const CAMERA_PRESET = VideoPresets.h360

/** Why a camera or microphone could not be used, in terms the screen can explain. */
export type MediaProblem = 'blocked' | 'missing' | 'busy' | 'failed'

export function mediaProblem(error: unknown): MediaProblem {
  switch (MediaDeviceFailure.getFailure(error)) {
    case MediaDeviceFailure.PermissionDenied:
      return 'blocked'
    case MediaDeviceFailure.NotFound:
      return 'missing'
    case MediaDeviceFailure.DeviceInUse:
      return 'busy'
    default:
      return 'failed'
  }
}

export function openCamera(deviceId?: string): Promise<LocalVideoTrack> {
  return createLocalVideoTrack({ resolution: CAMERA_PRESET.resolution, ...(deviceId ? { deviceId } : {}) })
}

export function openMicrophone(deviceId?: string): Promise<LocalAudioTrack> {
  return createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId } : {}) })
}

/** Cameras or microphones, with their names once the browser has been allowed to use one (it hides them until then). */
export function listDevices(kind: 'audioinput' | 'videoinput'): Promise<MediaDeviceInfo[]> {
  return Room.getLocalDevices(kind, false)
}

/** Phones (Android Chrome, iOS Safari) cannot share their screen: the button is shown only where it works. */
export function canShareScreen(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}
