import { expect, it } from 'vitest'
import { screenToWorld, worldToScreen, viewportPoint, zoomAt } from '../src/journal/canvas/camera.js'

const bounds = { left: 120, top: 80, width: 1000, height: 700 }

it('converts browser client coordinates to a point relative to the viewport center', () => {
  expect(viewportPoint({ x: 820, y: 530 }, bounds)).toEqual({ x: 200, y: 100 })
})

it.each([
  [.08, { x: 661.6, y: 407.6 }],
  [.55, { x: 671, y: 393.5 }],
  [1, { x: 680, y: 380 }],
  [2.4, { x: 708, y: 338 }],
])('accounts for viewport offset, camera translation and scale %s', (scale, point) => {
  const result = screenToWorld(point, bounds, { x: 40, y: -20, scale })
  expect(result.x).toBeCloseTo(20)
  expect(result.y).toBeCloseTo(-30)
})

it('uses the current viewport bounds after a parent scrolls', () => {
  expect(screenToWorld({ x: 680, y: 280 }, { ...bounds, top: -20 }, { x: 40, y: -20, scale: 1 })).toEqual({ x: 20, y: -30 })
})

it('projects a world point through camera translation and viewport offset', () => {
  expect(worldToScreen({ x: 20, y: -30 }, bounds, { x: 40, y: -20, scale: 1 })).toEqual({ x: 680, y: 380 })
})

it('zooms around a viewport point without mutating the previous camera', () => {
  const before = { x: 40, y: -20, scale: .55, detail: true }
  expect(zoomAt(before, 1.1, { x: 200, y: 100 })).toEqual({ x: -120, y: -140, scale: 1.1, detail: true })
  expect(before).toEqual({ x: 40, y: -20, scale: .55, detail: true })
})
