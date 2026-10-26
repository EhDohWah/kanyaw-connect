import { PusherClient } from '@/realtime/echo'

describe('the pusher-js client handed to Echo', () => {
  // The React Native build exports `{ Pusher }` (CommonJS) while its types promise a default export. Taking the default
  // gave Echo the wrapper object, and signing in crashed with "Object cannot be used as a constructor".
  it('is the Pusher class itself, so Echo can construct it', () => {
    expect(typeof PusherClient).toBe('function')
    expect(typeof PusherClient.prototype.subscribe).toBe('function')
    expect(typeof PusherClient.prototype.disconnect).toBe('function')
  })
})
