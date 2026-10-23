import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLikes } from '../../src/hooks/useLikes'

// Mock api
vi.mock('../../src/lib/api', () => ({
  checkLiked: vi.fn(),
  toggleLike: vi.fn(),
}))

import { checkLiked, toggleLike } from '../../src/lib/api'

describe('useLikes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize with correct values', () => {
    checkLiked.mockResolvedValue(false)

    const { result } = renderHook(() => useLikes(1, 'checkin', 5))

    expect(result.current.liked).toBe(false)
    expect(result.current.count).toBe(5)
    expect(result.current.loading).toBe(false)
  })

  it('should check if user has liked on mount', async () => {
    checkLiked.mockResolvedValue(true)

    renderHook(() => useLikes(1, 'checkin', 0))

    // Wait for the effect to run
    await vi.waitFor(() => {
      expect(checkLiked).toHaveBeenCalledWith(1, 'checkin')
    })
  })

  it('should toggle like when toggle is called', async () => {
    checkLiked.mockResolvedValue(false)
    toggleLike.mockResolvedValue(true)

    const { result } = renderHook(() => useLikes(1, 'checkin', 0))

    await act(async () => {
      await result.current.toggle()
    })

    expect(toggleLike).toHaveBeenCalledWith(1, 'checkin')
    expect(result.current.liked).toBe(true)
    expect(result.current.count).toBe(1)
  })

  it('should handle toggle error gracefully', async () => {
    checkLiked.mockResolvedValue(false)
    toggleLike.mockRejectedValue(new Error('Network error'))

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useLikes(1, 'checkin', 0))

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.liked).toBe(false)
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('should not toggle when already loading', async () => {
    checkLiked.mockResolvedValue(false)
    toggleLike.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(true), 100)))

    const { result } = renderHook(() => useLikes(1, 'checkin', 0))

    // Start first toggle
    act(() => {
      result.current.toggle()
    })

    // Try to toggle again while loading
    await act(async () => {
      await result.current.toggle()
    })

    // toggleLike should only be called once
    expect(toggleLike).toHaveBeenCalledTimes(1)
  })
})
