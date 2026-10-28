// Native modules that have no JavaScript stand-in in jest-expo.
import mockNetInfo from '@react-native-community/netinfo/jest/netinfo-mock'
import { AppState } from 'react-native'

jest.mock('@react-native-community/netinfo', () => mockNetInfo)

// React Native's Jest mock makes `AppState.currentState` a function; a phone that opens the app reports 'active'.
Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true })

// expo-crypto's native UUID is a stub in Jest: use Node's, so client ids are real and unique.
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  randomUUID: () => require('node:crypto').randomUUID(),
}))
