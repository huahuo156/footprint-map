import { describe, expect, it } from 'vitest'
import { layoutAtlas } from '../src/journal/atlasLayout'
import { cardBounds, intersects } from '../src/journal/model'
import { ATLAS_MAP_BOUNDS, atlasSceneBounds, atlasTilt, projectAtlasPoint } from '../src/journal/atlasScene'

const items = count => Array.from({ length: count }, (_, id) => ({ photo: { id: String(id) }, point: { x: 650, y: 300 } }))

describe('one-scene atlas', () => {
  it('keeps interleaved photos of each province in a compact block without other provinces inside it', () => {
    const provinces = [
      { code: 110000, center: [116.4, 40.1] },
      { code: 230000, center: [128, 47] },
      { code: 610000, center: [109, 35.5] },
      { code: 420000, center: [112, 31] },
      { code: 330000, center: [120, 29] },
    ]
    const interleaved = Array.from({ length: 20 }, (_, index) => ({ photo: { id: 'p' + index }, province: provinces[index % 5], point: { x: 650 + index % 5 * 10, y: 300 + index % 5 * 20 } }))
    const cards = layoutAtlas(interleaved)
    for (const province of provinces) {
      const own = cards.filter(card => card.province.code === province.code)
      expect(Math.max(...own.flatMap(a => own.map(b => Math.hypot(a.x - b.x, a.y - b.y))))).toBeLessThan(500)
      const left = Math.min(...own.map(card => card.x - 90)), right = Math.max(...own.map(card => card.x + 90))
      const top = Math.min(...own.map(card => card.y - 96)), bottom = Math.max(...own.map(card => card.y + 96))
      const block = { x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top }
      expect(cards.filter(card => card.province.code !== province.code).some(card => intersects(cardBounds(card, 0), block))).toBe(false)
    }
    expect(cards.map(card => card.photo.id)).toEqual(interleaved.map(item => item.photo.id))
  })

  it('places sparse western and eastern province groups near the matching map edge', () => {
    const cards = layoutAtlas([
      { photo: { id: 'west' }, province: { code: 1, center: [80, 33] }, point: { x: 400, y: 390 } },
      { photo: { id: 'east' }, province: { code: 2, center: [130, 33] }, point: { x: 700, y: 390 } },
    ])
    expect(cards[0].x).toBeLessThan(125)
    expect(cards[1].x).toBeGreaterThan(975)
    expect(Math.abs(cards[0].y - 340.5)).toBeLessThan(80)
    expect(Math.abs(cards[1].y - 340.5)).toBeLessThan(80)
  })

  it.each([20, 80, 200])('shows every one of %i located photos, clear of the enlarged map and other photos', count => {
    const cards = layoutAtlas(items(count))
    expect(cards).toHaveLength(count)
    const bounds = atlasSceneBounds(cards)
    for (const [index, card] of cards.entries()) {
      const box = cardBounds(card, 12)
      expect(intersects(box, ATLAS_MAP_BOUNDS)).toBe(false)
      expect(cards.slice(index + 1).some(other => intersects(box, cardBounds(other, 12)))).toBe(false)
      expect(Math.abs(card.x - 550) + box.w / 2).toBeLessThanOrEqual(bounds.width / 2)
      expect(Math.abs(card.y - 390) + box.h / 2).toBeLessThanOrEqual(bounds.height / 2)
    }
  })

  it('preserves safe manually placed photos beyond the original board', () => {
    expect(layoutAtlas(items(1), { 0: { x: -1200, y: 1800 } })[0]).toMatchObject({ x: -1200, y: 1800 })
  })

  it('straightens the map toward the screen on zoom-in and is parallel to it at high zoom', () => {
    expect(atlasTilt(.5)).toBe(20)
    expect(atlasTilt(1)).toBe(20)
    expect(atlasTilt(1.5)).toBeLessThan(atlasTilt(1))
    expect(atlasTilt(2)).toBeLessThan(atlasTilt(1.5))
    expect(atlasTilt(2.2)).toBe(0)
    expect(atlasTilt(2.42)).toBe(0)
    expect(atlasTilt(4)).toBe(0)
    const north = projectAtlasPoint({ x: 550, y: 290 }, atlasTilt(2.42))
    const south = projectAtlasPoint({ x: 550, y: 490 }, atlasTilt(2.42))
    expect(south.y - north.y).toBeCloseTo(330)
  })

  it('projects pins using the same scale, rotation and perspective as the map surface', () => {
    expect(projectAtlasPoint({ x: 550, y: 390 }, 58)).toEqual({ x: 550, y: 390 })
    expect(projectAtlasPoint({ x: 650, y: 290 }, 0)).toEqual({ x: 715, y: 225 })
    const projected = projectAtlasPoint({ x: 650, y: 290 }, 45)
    // A 165px vector rotated around X, then projected from a 1400px camera.
    const factor = 1400 / (1400 + 165 / Math.sqrt(2))
    expect(projected.x).toBeCloseTo(550 + 165 * factor)
    expect(projected.y).toBeCloseTo(390 - 165 / Math.sqrt(2) * factor)
  })
})
