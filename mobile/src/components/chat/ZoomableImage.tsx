// A picture that fills the screen and can be looked at closely: pinch to zoom, drag to move around when zoomed in,
// and double tap to zoom in or back out. The gestures run on the UI thread (Reanimated), so they follow the finger.
import { Image, type ImageErrorEventData } from 'expo-image'
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native'
import {
  GestureDetector,
  useCompetingGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'

const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5

function clamp(value: number, min: number, max: number): number {
  'worklet'
  return Math.min(Math.max(value, min), max)
}

export function ZoomableImage({
  uri,
  label,
  onError,
}: {
  uri: string
  label: string
  onError?: (event: ImageErrorEventData) => void
}) {
  const width = useSharedValue(0)
  const height = useSharedValue(0)
  const scale = useSharedValue(1)
  const startScale = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  /** Keeps the zoomed picture over the screen: it cannot be dragged off past its own edges. */
  const keepInside = (atScale: number, animate: boolean) => {
    'worklet'
    const maxX = (width.value * (atScale - 1)) / 2
    const maxY = (height.value * (atScale - 1)) / 2
    const nextX = clamp(x.value, -maxX, maxX)
    const nextY = clamp(y.value, -maxY, maxY)
    x.value = animate ? withTiming(nextX) : nextX
    y.value = animate ? withTiming(nextY) : nextY
  }

  const pinch = usePinchGesture({
    onBegin: () => {
      'worklet'
      startScale.value = scale.value
    },
    onUpdate: (event) => {
      'worklet'
      scale.value = clamp(startScale.value * event.scale, 0.8, MAX_SCALE + 1)
    },
    onDeactivate: () => {
      'worklet'
      // A little past either end while pinching, then back to the nearest allowed size.
      const settled = clamp(scale.value, 1, MAX_SCALE)
      scale.value = withTiming(settled)
      keepInside(settled, true)
    },
  })

  const pan = usePanGesture({
    averageTouches: true,
    onBegin: () => {
      'worklet'
      startX.value = x.value
      startY.value = y.value
    },
    onUpdate: (event) => {
      'worklet'
      if (scale.value <= 1) return
      x.value = startX.value + event.translationX
      y.value = startY.value + event.translationY
      keepInside(scale.value, false)
    },
  })

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      'worklet'
      if (scale.value > 1) {
        scale.value = withTiming(1)
        x.value = withTiming(0)
        y.value = withTiming(0)
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE)
      }
    },
  })

  const gesture = useCompetingGestures(doubleTap, useSimultaneousGestures(pinch, pan))

  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }))

  const onLayout = (event: LayoutChangeEvent) => {
    width.value = event.nativeEvent.layout.width
    height.value = event.nativeEvent.layout.height
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.fill} onLayout={onLayout} collapsable={false}>
        <Animated.View style={[styles.fill, animated]}>
          <Image
            source={uri}
            style={styles.fill}
            contentFit="contain"
            cachePolicy="memory-disk"
            accessible
            accessibilityRole="image"
            accessibilityLabel={label}
            onError={onError}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
})
