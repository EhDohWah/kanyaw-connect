import { fireEvent, render, screen } from '@testing-library/react-native'

import { Avatar } from '@/components/common/Avatar'

describe('Avatar', () => {
  it('shows initials when there is no photo', async () => {
    await render(<Avatar name="Naw Paw Say" seed="u1" />)
    expect(screen.getByText('NS', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('shows the photo, and initials instead when it cannot be loaded (not an empty circle)', async () => {
    await render(<Avatar name="Saw Eh Doh" seed="u2" src="http://example.org/a_256.webp" />)
    expect(screen.queryByText('SD', { includeHiddenElements: true })).toBeNull()

    await fireEvent(screen.getByTestId('avatar-photo'), 'error', { nativeEvent: { error: 'unreachable' } })
    expect(screen.getByText('SD', { includeHiddenElements: true })).toBeOnTheScreen()
  })

  it('tries a new photo again after an earlier one failed', async () => {
    const { rerender } = await render(<Avatar name="Saw Eh Doh" seed="u2" src="http://example.org/old.webp" />)
    await fireEvent(screen.getByTestId('avatar-photo'), 'error', { nativeEvent: { error: 'unreachable' } })

    await rerender(<Avatar name="Saw Eh Doh" seed="u2" src="http://example.org/new.webp" />)
    expect(screen.getByTestId('avatar-photo')).toBeOnTheScreen()
  })
})
