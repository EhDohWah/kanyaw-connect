import type { LocalAudioTrack, LocalVideoTrack } from 'livekit-client'
import { markRaw, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue'

import type { CallMedia } from '@/realtime/callSession'
import { listDevices, mediaProblem, openCamera, openMicrophone, type MediaProblem } from '@/realtime/localMedia'

/**
 * The camera and microphone on the pre-join screen: a live preview, on/off switches, the device lists, and what went
 * wrong (blocked, missing, busy). The open tracks go into the call as they are (`media()`), so the browser is asked once.
 * They are closed when the screen goes away, unless the call took them (`keep()` true and they are the ones it was given).
 */
export function usePreviewMedia(keep: () => boolean) {
  const micOn = ref(true)
  const cameraOn = ref(true)
  const video = shallowRef<LocalVideoTrack | null>(null)
  const audio = shallowRef<LocalAudioTrack | null>(null)
  const cameras = ref<MediaDeviceInfo[]>([])
  const microphones = ref<MediaDeviceInfo[]>([])
  const cameraId = ref('')
  const microphoneId = ref('')
  const problems = reactive<{ camera: MediaProblem | null; microphone: MediaProblem | null }>({ camera: null, microphone: null })
  const starting = reactive({ camera: false, microphone: false })
  let gone = false
  /** The tracks last handed to a join: only these may outlive the screen (the call sends them). */
  let given: { audio: LocalAudioTrack | null; video: LocalVideoTrack | null } = { audio: null, video: null }

  async function refreshDevices(): Promise<void> {
    try {
      const [videoInputs, audioInputs] = await Promise.all([listDevices('videoinput'), listDevices('audioinput')])
      // Without permission the browser lists nameless devices: nothing to choose between yet.
      cameras.value = videoInputs.filter((device) => device.label)
      microphones.value = audioInputs.filter((device) => device.label)
    } catch {
      // the lists stay as they were
    }
  }

  async function startCamera(): Promise<void> {
    starting.camera = true
    problems.camera = null
    try {
      const track = await openCamera(cameraId.value || undefined)
      // Switched off (or left) while the camera was starting.
      if (gone || !cameraOn.value) return track.stop()
      video.value?.stop()
      video.value = markRaw(track)
    } catch (error) {
      problems.camera = mediaProblem(error)
      cameraOn.value = false
    } finally {
      starting.camera = false
    }
  }

  async function startMicrophone(): Promise<void> {
    starting.microphone = true
    problems.microphone = null
    try {
      const track = await openMicrophone(microphoneId.value || undefined)
      if (gone || !micOn.value) return track.stop()
      audio.value?.stop()
      audio.value = markRaw(track)
    } catch (error) {
      problems.microphone = mediaProblem(error)
      micOn.value = false
    } finally {
      starting.microphone = false
    }
  }

  // Switched on (after the browser may have asked): the devices may now have names to list.
  async function setCamera(on: boolean): Promise<void> {
    cameraOn.value = on
    if (on) return startCamera().then(refreshDevices)
    video.value?.stop()
    video.value = null
  }

  async function setMicrophone(on: boolean): Promise<void> {
    micOn.value = on
    if (on) return startMicrophone().then(refreshDevices)
    audio.value?.stop()
    audio.value = null
  }

  /** Another camera or microphone: reopened on the new device (only if it is on). */
  async function chooseCamera(deviceId: string): Promise<void> {
    cameraId.value = deviceId
    if (!cameraOn.value) return
    video.value?.stop()
    video.value = null
    await startCamera()
  }

  async function chooseMicrophone(deviceId: string): Promise<void> {
    microphoneId.value = deviceId
    if (!micOn.value) return
    audio.value?.stop()
    audio.value = null
    await startMicrophone()
  }

  /** What to join with. */
  function media(): CallMedia {
    given = { audio: audio.value, video: video.value }
    return {
      micOn: micOn.value,
      cameraOn: cameraOn.value,
      audioTrack: audio.value,
      videoTrack: video.value,
      audioDeviceId: microphoneId.value || undefined,
      videoDeviceId: cameraId.value || undefined,
    }
  }

  // Both at once (one permission question in most browsers), then the device lists: listing while the browser is still
  // asking would only list nameless devices.
  onMounted(() => {
    void Promise.allSettled([startCamera(), startMicrophone()]).then(refreshDevices)
  })

  onBeforeUnmount(() => {
    gone = true
    const handedOver = keep()
    if (!handedOver || video.value !== given.video) video.value?.stop()
    if (!handedOver || audio.value !== given.audio) audio.value?.stop()
  })

  return {
    micOn,
    cameraOn,
    video,
    cameras,
    microphones,
    cameraId,
    microphoneId,
    problems,
    starting,
    setCamera,
    setMicrophone,
    chooseCamera,
    chooseMicrophone,
    media,
  }
}
