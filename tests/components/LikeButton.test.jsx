import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LikeButton from '../../src/components/LikeButton'

// Mock useLikes hook
vi.mock('../../src/hooks/useLikes', () => ({
  useLikes: vi.fn(),
}))

import { useLikes } from '../../src/hooks/useLikes'

describe('LikeButton', () => {
  it('should render with count', () => {
    useLikes.mockReturnValue({
      liked: false,
      count: 42,
      loading: false,
      toggle: vi.fn(),
    })

    render(<LikeButton targetId={1} targetType="checkin" count={42} />)

    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('should render with liked state', () => {
    useLikes.mockReturnValue({
      liked: true,
      count: 10,
      loading: false,
      toggle: vi.fn(),
    })

    render(<LikeButton targetId={1} targetType="checkin" count={10} />)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('text-red-500')
  })

  it('should call toggle when clicked', () => {
    const toggle = vi.fn()
    useLikes.mockReturnValue({
      liked: false,
      count: 0,
      loading: false,
      toggle,
    })

    render(<LikeButton targetId={1} targetType="checkin" count={0} />)

    const button = screen.getByRole('button')
    fireEvent.click(button)

    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('should be disabled when loading', () => {
    useLikes.mockReturnValue({
      liked: false,
      count: 0,
      loading: true,
      toggle: vi.fn(),
    })

    render(<LikeButton targetId={1} targetType="checkin" count={0} />)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
  })

  it('should format large counts', () => {
    useLikes.mockReturnValue({
      liked: false,
      count: 15000,
      loading: false,
      toggle: vi.fn(),
    })

    render(<LikeButton targetId={1} targetType="checkin" count={15000} />)

    expect(screen.getByText('1.5万')).toBeInTheDocument()
  })
})
