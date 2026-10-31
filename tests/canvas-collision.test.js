import { describe, expect, it } from 'vitest'
import { cardBounds, findFreePosition, intersects, layoutCanvasGroups, planPhotoImport } from '../src/journal/model.js'
import { canvasObstacles, collisionItems, placeCanvasItem, planCanvasGroupMove, planCanvasRepair } from '../src/journal/canvasCollision.js'
import { planGroupExpansion } from '../src/journal/groupExpansion.js'

const photo = (id, x = 0, y = 0) => ({ id, kind: 'photo', x, y, width: 100, height: 100, rotation: 0 })
const book = { id: 'book', canvas_x: 0, canvas_y: 0 }
const scene = (items = [], groups = [], notebooks = []) => ({ items, groups: layoutCanvasGroups(groups, items), notebooks, headers: [] })
const sticker = { id: 'sticker', kind: 'mark', entry: { mark: { kind: 'sticker' } }, x: 0, y: 0, width: 152, height: 152 }
const raw = () => ({ trips: [], marks: [], notebooks: [book], entries: [{ id: 'entry', entry_date: '2026-10-27', components: [], photos: [{ id: 'p', url: '/p.png', components: [], canvas_absolute: 1, canvas_x: 0, canvas_y: 0, rotation: 0 }] }], canvas_groups: [{ id: 'group', photo_ids: ['p'], collapsed: true }] })

describe('canvas-wide collision rules', () => {
  it('moves a notebook away from an expanded group including its empty background', () => {
    const state = scene([photo('p', -400), photo('q', 400)], [{ id: 'group', photo_ids: ['p', 'q'] }])
    const item = { id: 'book', kind: 'notebook', x: 0, y: 0, width: 250, height: 330 }
    const position = placeCanvasItem(item, state)
    expect(Math.abs(position.x) >= 607 || Math.abs(position.y + 16) >= 256).toBe(true)
    expect(position).not.toEqual({ x: 0, y: 0 })
  })

  it('moves a folded group clear of a notebook and preserves every hidden member offset', () => {
    const items = [photo('p'), photo('q', 800, 50)]
    const state = scene(items, [{ id: 'group', photo_ids: ['p', 'q'], collapsed: true }], [book])
    const result = planCanvasGroupMove('group', state, { x: 0, y: 0 })
    expect(result).toHaveLength(2)
    expect(result[1].x - result[0].x).toBeCloseTo(800)
    expect(result[1].y - result[0].y).toBeCloseTo(50)
    expect(Math.abs(result[0].x) >= 283 || Math.abs(result[0].y) >= 283).toBe(true)
    expect(items[0]).toEqual(photo('p'))
  })

  it('ignores stickers in both directions while text still avoids content', () => {
    expect(placeCanvasItem(sticker, scene([photo('p')], [], [book]))).toEqual({ x: 0, y: 0 })
    expect(canvasObstacles(scene([sticker]))).toEqual([])
    expect(placeCanvasItem(photo('p'), scene([sticker]))).toEqual({ x: 0, y: 0 })
    const text = { ...sticker, id: 'text', entry: { mark: { kind: 'text' } } }
    expect(placeCanvasItem(text, scene([photo('p')]))).not.toEqual({ x: 0, y: 0 })
  })

  it('excludes containing ancestors but reserves unrelated expanded siblings', () => {
    const items = [photo('p'), photo('q', 800)]
    const state = scene(items, [{ id: 'parent', photo_ids: [] }, { id: 'a', parent_id: 'parent', photo_ids: ['p'] }, { id: 'b', parent_id: 'parent', photo_ids: ['q'] }])
    expect(planCanvasGroupMove('a', state, { x: 0, y: 0 })[0]).toMatchObject({ x: 0, y: 0 })
    const moved = planCanvasGroupMove('a', state, { x: 800, y: 0 })
    expect(moved[0]).not.toMatchObject({ x: 800, y: 0 })
  })

  it('reserves notebooks on group expansion and ignores stickers', () => {
    const groups = [{ id: 'a', photo_ids: ['p'], collapsed: true }]
    expect(planGroupExpansion('a', groups, [photo('p'), sticker])).toEqual([])
    expect(planGroupExpansion('a', groups, [photo('p')], [book])).toHaveLength(1)
  })

  it('repairs existing cover overlaps, preserves raw data and converges after applying saved changes', () => {
    const data = raw(), before = structuredClone(data)
    const result = planCanvasRepair(data)
    expect(result.items).toHaveLength(1)
    expect(result.notebooks).toHaveLength(0)
    expect(result.items[0]).toMatchObject({ id: 'p', kind: 'photo' })
    const p = data.entries[0].photos[0], change = result.items[0]
    expect(Math.abs(change.x) >= 283 || Math.abs(change.y) >= 283).toBe(true)
    expect(data).toEqual(before)
    Object.assign(p, { canvas_x: change.x, canvas_y: change.y })
    expect(planCanvasRepair(data)).toEqual({ items: [], notebooks: [] })
  })

  it('does not repair stickers or content placed inside notebook pages', () => {
    const data = raw()
    data.notebook_items = [{ kind: 'photo', id: 'p', page_id: 'page', x: 400, y: 400 }]
    data.marks = [{ id: 's', kind: 'sticker', sticker: 'flower', size: 'large', canvas_x: 0, canvas_y: 0, captured_on: '2026-10-27' }]
    expect(planCanvasRepair(data)).toEqual({ items: [], notebooks: [] })
  })

  it('reserves a new notebook around older content rather than pushing old content away', () => {
    const data = raw(), previous = { ...data, notebooks: [] }
    const result = planCanvasRepair(data, previous)
    expect(result.items).toHaveLength(0)
    expect(result.notebooks).toHaveLength(1)
  })

  it('uses positive bounds for all allowed rotations', () => {
    expect(cardBounds({ x: 0, y: 0, width: 100, height: 60, rotation: 180 }, 0).w).toBeCloseTo(100)
    expect(cardBounds({ x: 0, y: 0, width: 100, height: 60, rotation: 135 }, 0).w).toBeCloseTo(113.137, 3)
  })

  it('keeps the same occupied photo space before decoding, after decoding and after reload', () => {
    const item = { ...photo('p'), url: '/tiny', width: 40, height: 40 }
    const before = collisionItems([item])[0]
    const after = collisionItems([item], { '/tiny': { width: 20, height: 20 } })[0]
    expect(cardBounds(after)).toEqual(cardBounds(before))
  })

  it('uses the same stable reservation for incoming imports as later reloads', () => {
    const planned = planPhotoImport(2, { x: 0, y: 0 }, [], [{ width: 20, height: 20 }, { width: 20, height: 20 }])
    expect(planned.every(item => item.width >= 280 && item.height >= 350)).toBe(true)
    expect(intersects(cardBounds(planned[0]), cardBounds(planned[1]))).toBe(false)
  })

  it('prevents a moved group member from stretching its parent background across a notebook', () => {
    const items = [photo('p', -800), photo('q', -600)]
    const state = scene(items, [{ id: 'group', photo_ids: ['p', 'q'] }], [book])
    const position = placeCanvasItem({ ...items[1], x: 600 }, state)
    const updated = layoutCanvasGroups([{ id: 'group', photo_ids: ['p', 'q'] }], [items[0], { ...items[1], ...position }])[0].bounds
    expect(updated.left + updated.width <= -143 || updated.top + updated.height <= -183 || updated.top >= 183).toBe(true)
  })

  it('keeps stationary siblings fixed when moving a nested group near a notebook', () => {
    const groups = [{ id: 'parent', photo_ids: [] }, { id: 'a', parent_id: 'parent', photo_ids: ['p'] }, { id: 'b', parent_id: 'parent', photo_ids: ['q'] }]
    const items = [photo('p'), photo('q', 800)]
    const state = scene(items, groups, [{ ...book, canvas_x: 400, canvas_y: 500 }])
    const changes = planCanvasGroupMove('a', state, { x: 0, y: 900 })
    const updated = layoutCanvasGroups(groups, items.map(item => ({ ...item, ...changes.find(change => change.id === item.id) })))
    const parent = updated.find(group => group.id === 'parent').bounds
    expect(parent.left + parent.width <= 257 || parent.left >= 543 || parent.top + parent.height <= 317 || parent.top >= 683).toBe(true)
    expect(changes.map(change => change.id)).toEqual(['p'])
  })

  it('keeps existing and newly created content clear of the visible West Lake scene heading', () => {
    const data = raw()
    data.canvas_groups = []
    data.trips = [{ id: 'trip', name: '西湖', canvas_x: 0, canvas_y: 0 }]
    Object.assign(data.entries[0], { components: null, trip_id: 'trip', place_name: '西湖' })
    Object.assign(data.entries[0].photos[0], { components: null, canvas_x: 1000, canvas_y: 1000 })
    data.notebooks[0] = { ...book, canvas_y: -220 }
    expect(planCanvasRepair(data).notebooks).toHaveLength(1)
  })

  it('finds a guaranteed empty position even outside the previous fixed fallback radius', () => {
    const obstacle = { x: 0, y: 0, w: 40000, h: 40000 }
    const item = photo('p')
    const result = findFreePosition(item, [obstacle])
    expect(intersects(cardBounds({ ...item, ...result }), obstacle)).toBe(false)
  })
})
