import { expect, it } from 'vitest'
import { layoutPosition, planSelectionMove, selectionCamera } from '../src/journal/canvas/selectionLayout.js'
const item = (id, x = 0, y = 0, extra = {}) => ({ id, kind: 'photo', x, y, width: 100, height: 100, rotation: 0, ...extra })
const scene = items => ({ items, groups: [], notebooks: [], headers: [] })
const group = (id, ids, extra = {}) => ({ id, photo_ids: ids, parent_id: null, hidden: false, bounds: { left: -100, top: -100, width: 200, height: 200 }, ...extra })
it.each([[1, 0], [-1, 0], [0, 1], [0, -1], [10, 0], [0, -10]])('moves all selected objects exactly by %s,%s', (x, y) => {
  const s = scene([item('a'), item('b', 400, 20, { rotation: 12 })])
  const original = structuredClone(s)
  expect(planSelectionMove(s, new Set(['a', 'b']), { x, y })).toEqual([{ id: 'a', kind: 'photo', x, y, rotation: 0 }, { id: 'b', kind: 'photo', x: 400 + x, y: 20 + y, rotation: 12 }])
  expect(s).toEqual(original)
})
it('does not treat empty space between disconnected choices as an obstacle', () => {
  expect(planSelectionMove(scene([item('a', -500), item('b', 500), item('stationary')]), ['a', 'b'], { x: 1, y: 0 })).toHaveLength(2)
})
it('rejects the entire batch on collision without seeking another position', () => {
  expect(() => planSelectionMove(scene([item('a'), item('b', 118), item('c', -500)]), ['a', 'c'], { x: 1, y: 0 })).toThrow('受其他内容阻挡')
})
it('keeps standalone stickers exempt from collision', () => {
  expect(planSelectionMove(scene([item('a', 0, 0, { kind: 'mark', entry: { mark: { kind: 'sticker' } } }), item('b')]), ['a'], { x: 1, y: 0 })[0].x).toBe(1)
})
it('checks notebook and header obstacles', () => {
  for (const obstacle of [{ notebooks: [{ id: 'book', canvas_x: 200, canvas_y: 0 }] }, { headers: [{ x: 100, y: 0, w: 100, h: 100 }] }]) {
    expect(() => planSelectionMove({ ...scene([item('a')]), ...obstacle }, ['a'], { x: 10, y: 0 })).toThrow('受其他内容阻挡')
  }
})
it('moves folded/nested root groups atomically and rejects partial membership', () => {
  const s = { ...scene([item('a', -30), item('b', 30)]), groups: [group('root', ['a', 'b'], { collapsed: true }), group('child', ['a'], { parent_id: 'root', hidden: true })] }
  expect(planSelectionMove(s, ['a', 'b'], { x: 1, y: 0 }).map(p => p.x)).toEqual([-29, 31])
  expect(() => planSelectionMove(s, ['a'], { x: 1, y: 0 })).toThrow()
})
it('uses API anchors and canonical record ids without moving rotation', () => {
  expect(layoutPosition(item('rendered', 600, 120, { kind: 'entry', anchor: { x: 500, y: 100 }, entry: { record_id: 'record' }, rotation: -2 }), { x: 10, y: -1 })).toEqual({ id: 'record', kind: 'entry', x: 110, y: 19, rotation: -2 })
  expect(layoutPosition(item('photo', 600, 120, { anchor: { x: 500, y: 100 } })).x).toBe(600)
})
it.each([[], ['missing'], ['a', 'a'], Array(501).fill('a')].map(ids => [ids]))('rejects invalid selection %j', ids => {
  expect(() => planSelectionMove(scene([item('a')]), ids, { x: 1, y: 0 })).toThrow()
})
it('rejects ambiguous ids, incomplete groups and out of range targets', () => {
  expect(() => planSelectionMove(scene([item('a'), item('a', 0, 0, { kind: 'mark' })]), ['a'], { x: 1, y: 0 })).toThrow()
  expect(() => planSelectionMove({ ...scene([item('a')]), groups: [group('root', ['a', 'missing'])] }, ['a'], { x: 1, y: 0 })).toThrow()
  expect(() => planSelectionMove(scene([item('a', 1e7)]), ['a'], { x: 1, y: 0 })).toThrow()
})
it('frames actual visual geometry with 80px margins and no save side effects', () => {
  expect(selectionCamera(scene([item('a', 1000, -200, { width: 200, height: 100 })]), ['a'], { width: 378, height: 278 })).toEqual({ scale: 1, x: -1000, y: 200, detail: true })
})
it('frames multiple choices and respects min/max scale', () => {
  expect(selectionCamera(scene([item('a', -500), item('b', 500)]), ['a', 'b'], { width: 1278, height: 400 }).scale).toBe(1)
  expect(selectionCamera(scene([item('a', 0, 0, { width: 100000 })]), ['a'], { width: 100, height: 100 }).scale).toBe(.08)
})
it('uses folded cover geometry instead of hidden photo extents', () => {
  const s = { ...scene([item('a', -2000), item('b', 2000)]), groups: [group('root', ['a', 'b'], { collapsed: true })] }
  expect(selectionCamera(s, ['a', 'b'], { width: 378, height: 378 })).toEqual({ scale: 1, x: 0, y: 0, detail: true })
})
it('accounts for rotated visual bounds', () => {
  const result = selectionCamera(scene([item('a', 0, 0, { width: 200, height: 100, rotation: 20 })]), ['a'], { width: 378, height: 400 })
  expect(result.scale).toBeCloseTo(218 / (200 * Math.cos(Math.PI / 9) + 100 * Math.sin(Math.PI / 9) + 18))
})
