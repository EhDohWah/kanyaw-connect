import { fireEvent, render, screen } from '@testing-library/react-native'

import { Avatar } from '@/components/common/Avatar'

const hidden = { includeHiddenElements: true }

describe('Avatar', () => {
  it('shows initials when there is no photo', async () => {
    await render(<Avatar name="Naw Paw Say" seed="u1" />)
    expect(screen.getByText('NS', hidden)).toBeOnTheScreen()
    expect(screen.queryByTestId('avatar-photo', hidden)).toBeNull()
  })

  it('shows initials while the photo loads, then only the photo (never an empty space)', async () => {
    await render(<Avatar name="Saw Eh Doh" seed="u2" src="http://example.org/a_256.webp" />)
    expect(screen.getByTestId('avatar-photo', hidden)).toBeOnTheScreen()
    expect(screen.getByText('SD', hidden)).toBeOnTheScreen()

    await fireEvent(screen.getByTestId('avatar-photo', hidden), 'load', {
      nativeEvent: { source: { width: 256, height: 256 } },
    })
    expect(screen.queryByText('SD', hidden)).toBeNull()
    expect(screen.getByTestId('avatar-photo', hidden)).toBeOnTheScreen()
  })

  it('keeps the initials and drops the photo when it cannot be loaded', async () => {
    await render(<Avatar name="Saw Eh Doh" seed="u2" src="http://example.org/a_256.webp" />)

    await fireEvent(screen.getByTestId('avatar-photo', hidden), 'error', { nativeEvent: { error: 'unreachable' } })
    expect(screen.getByText('SD', hidden)).toBeOnTheScreen()
    expect(screen.queryByTestId('avatar-photo', hidden)).toBeNull()
  })

  it('tries a new photo again after an earlier one failed, with initials until it loads', async () => {
    const { rerender } = await render(<Avatar name="Saw Eh Doh" seed="u2" src="http://example.org/old.webp" />)
    await fireEvent(screen.getByTestId('avatar-photo', hidden), 'error', { nativeEvent: { error: 'unreachable' } })

    await rerender(<Avatar name="Saw Eh Doh" seed="u2" src="http://example.org/new.webp" />)
    expect(screen.getByTestId('avatar-photo', hidden)).toBeOnTheScreen()
    expect(screen.getByText('SD', hidden)).toBeOnTheScreen()
  })
})
