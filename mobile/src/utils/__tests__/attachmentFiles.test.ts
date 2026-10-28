import { safeFileName } from '@/utils/attachmentFiles'

jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: {} }))
jest.mock('expo-media-library', () => ({}))
jest.mock('expo-sharing', () => ({}))

describe('safeFileName', () => {
  it('keeps an ordinary name, including Burmese and Karen letters', () => {
    expect(safeFileName('Minutes 14 March.pdf')).toBe('Minutes 14 March.pdf')
    expect(safeFileName('မင်္ဂလာပါ.docx')).toBe('မင်္ဂလာပါ.docx')
  })

  it('replaces characters a file system refuses, and never makes a hidden file or a path', () => {
    expect(safeFileName('a/b\\c:d*e?.txt')).toBe('a_b_c_d_e_.txt')
    expect(safeFileName('../../secret')).toBe('_.._secret')
    expect(safeFileName('.profile')).toBe('profile')
    expect(safeFileName('   ')).toBe('file')
  })

  it('shortens a very long name but keeps its extension', () => {
    const name = safeFileName(`${'a'.repeat(300)}.pdf`)
    expect(name).toHaveLength(120)
    expect(name.endsWith('.pdf')).toBe(true)
  })
})
