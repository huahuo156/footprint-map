import { afterEach, expect, it } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useCanvasImageDimensions } from '../src/journal/images/useCanvasImageDimensions.js'
import { clearApiSession } from '../src/lib/api.js'

afterEach(cleanup)
const fixture = () => {
  const frames = []
  const options = { ownerId: 'a', sources: ['/uploads/a.jpg', '/uploads/b.jpg'], requestFrame: callback => { frames.push(callback); return frames.length }, cancelFrame: () => {} }
  return { frames, options, flush: () => { act(() => { frames.splice(0).forEach(callback => callback()) }) } }
}
it('publishes one dimensions snapshot per frame and ignores repeated dimensions', () => {
  const h = fixture()
  const { result } = renderHook(() => useCanvasImageDimensions(h.options))
  act(() => {
    result.current.recordDimensions('/uploads/a.jpg', { width: 2, height: 1 })
    result.current.recordDimensions('/uploads/b.jpg', { width: 1, height: 2 })
  })
  expect(result.current.imageSizes).toEqual({})
  h.flush()
  expect(result.current.imageSizes).toEqual({ '/uploads/a.jpg': { width: 2, height: 1 }, '/uploads/b.jpg': { width: 1, height: 2 } })
  const snapshot = result.current.imageSizes
  act(() => result.current.recordDimensions('/uploads/a.jpg', { width: 2, height: 1 }))
  h.flush()
  expect(result.current.imageSizes).toBe(snapshot)
})
it('drops old account callbacks and invalidates pending frames on API reset', () => {
  const h = fixture()
  const { result, rerender } = renderHook(props => useCanvasImageDimensions(props), { initialProps: h.options })
  const old = result.current.recordDimensions
  act(() => old('/uploads/a.jpg', { width: 2, height: 1 }))
  act(clearApiSession)
  h.flush()
  expect(result.current.imageSizes).toEqual({})
  act(() => old('/uploads/a.jpg', { width: 9, height: 9 }))
  h.flush()
  expect(result.current.imageSizes).toEqual({})
  rerender({ ...h.options, ownerId: 'b' })
  act(() => old('/uploads/a.jpg', { width: 9, height: 9 }))
  h.flush()
  expect(result.current.imageSizes).toEqual({})
})
it('drops removed sources and never accepts dimensions for non-members', () => {
  const h = fixture()
  const { result, rerender } = renderHook(props => useCanvasImageDimensions(props), { initialProps: h.options })
  act(() => result.current.recordDimensions('/uploads/a.jpg', { width: 2, height: 1 }))
  h.flush()
  rerender({ ...h.options, sources: ['/uploads/b.jpg'] })
  act(() => result.current.recordDimensions('/uploads/a.jpg', { width: 3, height: 1 }))
  h.flush()
  expect(result.current.imageSizes).toEqual({})
})

it('retains dimensions when a private source only changes thumbnail spelling', () => {
  const h = fixture()
  const { result, rerender } = renderHook(props => useCanvasImageDimensions(props), { initialProps: h.options })
  act(() => result.current.recordDimensions('/uploads/a.jpg', { width: 2, height: 1 }))
  h.flush()
  rerender({ ...h.options, sources: ['/uploads/a.jpg?thumbnail=1', '/uploads/b.jpg'] })
  h.flush()
  expect(result.current.imageSizes['/uploads/a.jpg?thumbnail=1']).toEqual({ width: 2, height: 1 })
})
