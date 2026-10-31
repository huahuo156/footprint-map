import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import JourneyCanvas from '../src/journal/JourneyCanvas.jsx'
let frames
beforeEach(() => {
  frames = []
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', callback => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  localStorage.setItem('shitu-camera-v1', JSON.stringify({ x: 0, y: 0, scale: 1, detail: true }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear() })
it('batches loaded dimensions without moving pinned photos or saving layout', () => {
  const onMove = vi.fn(), onMoveGroup = vi.fn()
  render(<JourneyCanvas data={{ trips: [], entries: [{ id: 'e', entry_date: '2026-10-31', components: [], photos: [{ id: 'a', url: '/uploads/a.jpg', canvas_absolute: 1, canvas_x: 100, canvas_y: 50, rotation: 0 }] }], notebooks: [], canvas_groups: [] }} onMove={onMove} onMoveGroup={onMoveGroup} />)
  const photo = document.querySelector('[data-photo-id="a"]'), img = photo.querySelector('img')
  const beforeHeight = photo.style.height, beforeTransform = photo.style.transform
  Object.defineProperties(img, { naturalWidth: { value: 1200 }, naturalHeight: { value: 600 } })
  fireEvent.load(img)
  expect(photo.style.height).toBe(beforeHeight)
  act(() => { frames.splice(0).forEach(callback => callback(performance.now())) })
  expect(photo.style.height).not.toBe(beforeHeight)
  expect(photo.style.transform).toBe(beforeTransform)
  expect(onMove).not.toHaveBeenCalled()
  expect(onMoveGroup).not.toHaveBeenCalled()
})
