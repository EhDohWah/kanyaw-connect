// Renders the real routes in `app/`, like expo-router's `renderRouter`, but with real timers: `renderRouter` switches
// to fake ones, which stalled the app's own waiting (secure storage, requests, redirects made while the saved session
// is read) and leaked from one test into the next.
import { render } from '@testing-library/react-native'
import { ExpoRoot } from 'expo-router/build/ExpoRoot'
import { getRouteInfoFromState, type StrictState } from 'expo-router/build/global-state/getRouteInfoFromState'
import { navigationRef } from 'expo-router/build/global-state/navigationRef'
import { getMockContext } from 'expo-router/testing-library'

export async function renderApp(initialUrl = '/'): Promise<void> {
  jest.useRealTimers()
  // Load every route at once, as `renderRouter` does.
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync'
  await render(<ExpoRoot context={getMockContext('./app')} location={initialUrl} />)
}

/** The address on screen, for example `/chats/c1`. */
export function currentPath(): string {
  return getRouteInfoFromState(navigationRef.getRootState() as StrictState).pathname
}
