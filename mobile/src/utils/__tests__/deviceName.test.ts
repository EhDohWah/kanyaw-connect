import { describeDevice } from '@/utils/deviceName'

describe('describeDevice', () => {
  it('names the phone and its system, as the token list shows it', () => {
    expect(describeDevice('Pixel 7', 'android')).toBe('Pixel 7 (Android)')
    expect(describeDevice('iPhone 15', 'ios')).toBe('iPhone 15 (iOS)')
  })

  it('says "Phone" when the model is unknown or blank', () => {
    expect(describeDevice(null, 'android')).toBe('Phone (Android)')
    expect(describeDevice('   ', 'ios')).toBe('Phone (iOS)')
  })
})
