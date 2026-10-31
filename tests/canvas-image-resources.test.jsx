import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import CanvasItem from '../src/journal/CanvasItem.jsx'
import CanvasImageResources from '../src/journal/images/CanvasImageResources.jsx'

// Isolate the shell contract from camera/layout effects in the full canvas.
vi.mock('../src/journal/JourneyCanvas', () => ({ default: function CanvasProbe(props) {
  const [value, setValue] = useState('')
  return <><input aria-label="camera state" value={value} onChange={event => setValue(event.target.value)} /><output>{JSON.stringify({ residency: props.imageResidency, cache: props.imageCache, profile: props.imageProfile })}</output></>
} }))
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('defaults off and prevents cache-only opt-in', () => {
  vi.stubEnv('VITE_CANVAS_IMAGE_RESIDENCY', '')
  vi.stubEnv('VITE_CANVAS_IMAGE_CACHE', '')
  const view = render(<CanvasImageResources data={{ entries: [] }} imageProfile="desktop" />)
  expect(screen.getByRole('status').textContent).toBe('{"residency":false,"cache":false,"profile":"desktop"}')
  view.rerender(<CanvasImageResources data={{ entries: [] }} imageResidency={false} imageCache imageProfile="desktop" />)
  expect(screen.getByRole('status').textContent).toContain('"cache":false')
})

it('preserves canvas state across flag and profile changes', () => {
  const view = render(<CanvasImageResources data={{ entries: [] }} imageResidency={false} imageProfile="desktop" />)
  fireEvent.change(screen.getByLabelText('camera state'), { target: { value: 'pan selection' } })
  view.rerender(<CanvasImageResources data={{ entries: [] }} imageResidency imageCache imageProfile="tablet" demo />)
  expect(screen.getByLabelText('camera state').value).toBe('pan selection')
  expect(screen.getByRole('status').textContent).toContain('"residency":true')
  expect(screen.getByRole('status').textContent).toContain('"profile":"tablet"')
})

it('enables residency from the build flag and updates budgets on viewport resize', () => {
  vi.stubEnv('VITE_CANVAS_IMAGE_RESIDENCY', 'true')
  vi.stubEnv('VITE_CANVAS_IMAGE_CACHE', 'true')
  const oldWidth = window.innerWidth
  window.innerWidth = 800
  const view = render(<CanvasImageResources data={{ entries: [] }} demo />)
  expect(screen.getByRole('status').textContent).toBe('{"residency":true,"cache":true,"profile":"tablet"}')
  window.innerWidth = 1400
  fireEvent.resize(window)
  view.rerender(<CanvasImageResources data={{ entries: [] }} demo />)
  expect(screen.getByRole('status').textContent).toContain('"profile":"desktop"')
  window.innerWidth = oldWidth
})

function pointer(target, type, pointerId) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: pointerId })
  fireEvent(target, event)
}

it('queues the latest automatic profile until every canvas pointer ends', () => {
  const oldWidth = window.innerWidth
  window.innerWidth = 1400
  const view = render(<CanvasImageResources data={{ entries: [] }} />)
  const input = screen.getByLabelText('camera state')
  fireEvent.change(input, { target: { value: 'selection and camera' } })
  pointer(input, 'pointerdown', 1)
  pointer(input.parentElement, 'pointerdown', 2)
  window.innerWidth = 800
  fireEvent.resize(window)
  expect(screen.getByRole('status').textContent).toContain('"profile":"desktop"')
  pointer(window, 'pointerup', 1)
  expect(screen.getByRole('status').textContent).toContain('"profile":"desktop"')
  pointer(window, 'pointercancel', 2)
  expect(screen.getByRole('status').textContent).toContain('"profile":"tablet"')
  expect(input.value).toBe('selection and camera')
  view.unmount()
  window.innerWidth = oldWidth
})

it('defers explicit overrides and releases stuck gestures on blur', () => {
  const view = render(<CanvasImageResources imageProfile="desktop" />)
  pointer(screen.getByLabelText('camera state'), 'pointerdown', 3)
  view.rerender(<CanvasImageResources imageProfile="tablet" />)
  expect(screen.getByRole('status').textContent).toContain('"profile":"desktop"')
  fireEvent.blur(window)
  expect(screen.getByRole('status').textContent).toContain('"profile":"tablet"')
})

it('observes coarse-pointer changes and removes every listener on unmount', () => {
  const query = new EventTarget()
  query.matches = false
  const removeQuery = vi.spyOn(query, 'removeEventListener')
  vi.stubGlobal('matchMedia', vi.fn(() => query))
  const removeWindow = vi.spyOn(window, 'removeEventListener')
  const oldWidth = window.innerWidth
  window.innerWidth = 1400
  const view = render(<CanvasImageResources />)
  expect(screen.getByRole('status').textContent).toContain('"profile":"desktop"')
  query.matches = true
  fireEvent(query, new Event('change'))
  expect(screen.getByRole('status').textContent).toContain('"profile":"tablet"')
  view.unmount()
  expect(removeQuery).toHaveBeenCalledWith('change', expect.any(Function))
  for (const name of ['resize', 'pointerup', 'pointercancel', 'blur']) {
    expect(removeWindow).toHaveBeenCalledWith(name, expect.any(Function))
  }
  window.innerWidth = oldWidth
})

it('tracks blank shell gestures and flushes the latest override on lost capture', () => {
  const view = render(<CanvasImageResources imageProfile="desktop" />)
  expect(view.container.firstChild.style.display).toBe('contents')
  pointer(view.container.firstChild, 'pointerdown', 7)
  view.rerender(<CanvasImageResources imageProfile="tablet" />)
  expect(screen.getByRole('status').textContent).toContain('"profile":"desktop"')
  view.rerender(<CanvasImageResources imageProfile="desktop" />)
  pointer(view.container.firstChild, 'lostpointercapture', 7)
  expect(screen.getByRole('status').textContent).toContain('"profile":"desktop"')
  pointer(view.container.firstChild, 'pointerdown', 8)
  view.rerender(<CanvasImageResources imageProfile="tablet" />)
  pointer(view.container.firstChild, 'lostpointercapture', 8)
  expect(screen.getByRole('status').textContent).toContain('"profile":"tablet"')
})

const photo = { id: 'p', kind: 'photo', x: 1, y: 2, width: 180, height: 150, imageHeight: 100, url: '/public/photo.jpg', entry: { place_name: '杭州', entry_date: '2026-10-31', components: [] } }
it('keeps nonresident photo geometry and keyboard/pointer interaction without an image', () => {
  const onOpen = vi.fn(), onPointerDown = vi.fn()
  const view = render(<CanvasItem item={photo} imageResident={false} onOpen={onOpen} onPointerDown={onPointerDown} />)
  const button = screen.getByRole('button')
  expect(view.container.querySelector('img')).toBeNull()
  expect(button.style.width).toBe('180px')
  fireEvent.pointerDown(button)
  fireEvent.click(button, { detail: 0 })
  expect(onPointerDown).toHaveBeenCalledOnce()
  expect(onOpen).toHaveBeenCalledWith(photo.entry, 'p')
  view.rerender(<CanvasItem item={photo} imageResident />)
  expect(view.container.querySelector('img').getAttribute('src')).toBe('/public/photo.jpg')
})
