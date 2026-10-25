// Copied from frontend/src/style.css (`@theme`). A test reads that file and fails when a value here differs, so change
// a colour there first, then here. The names are the CSS ones in camel case: --color-text-muted is `textMuted`.

export const colors = {
  // Page and surfaces
  bg: '#ffffff',
  surface: '#f4f4f5',
  border: '#e4e4e7',
  text: '#18181b',
  textMuted: '#6b6b73',

  // Brand
  primary: '#1d4e89',
  primaryHover: '#163d6b',
  primarySoft: '#e8eff8',
  onPrimary: '#ffffff',

  // States
  danger: '#c62828',
  dangerSoft: '#fdecea',
  success: '#1b7f3b',

  // Video call screen
  callBg: '#18181b',
  callSurface: '#27272a',
  callRaised: '#3f3f46',
  onCall: '#fafafa',
  onCallMuted: '#a1a1aa',
  onCallDanger: '#f28b82',

  // Initials avatars: eight calm hues, each readable with white text (no purple)
  avatar1: '#1d4e89',
  avatar2: '#2e7d32',
  avatar3: '#b45309',
  avatar4: '#00796b',
  avatar5: '#c62828',
  avatar6: '#5d4037',
  avatar7: '#37474f',
  avatar8: '#4e6b2f',
} as const

export type ColorName = keyof typeof colors

export const AVATAR_COLORS = [
  colors.avatar1,
  colors.avatar2,
  colors.avatar3,
  colors.avatar4,
  colors.avatar5,
  colors.avatar6,
  colors.avatar7,
  colors.avatar8,
] as const

/** Spacing in points, on a 4-point grid. */
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, full: 999 } as const

/**
 * Touch targets: 44 pt on iOS and 48 dp on Android at least, with 8 pt between them. 48 meets both.
 */
export const TOUCH_TARGET = 48
export const TOUCH_GAP = 8

/** The web's body text is 15 px; form fields 16 px (on iOS a smaller field zooms the page; here it keeps the two alike). */
export const fontSize = { xs: 12, sm: 14, body: 15, field: 16, lg: 18, xl: 22, xxl: 26 } as const
