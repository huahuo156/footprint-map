import { describe, expect, it } from 'vitest'
import { expandCanvasGroups, expandGroupSelection, toggleGroupSelection } from '../shared/journal-groups.js'
import { layoutCanvasGroups, canvasDropObstacles, findFreePosition } from '../src/journal/model.js'

const groups = [
  { id: 'a', photo_ids: ['1', '2'], parent_id: 'outer' },
  { id: 'b', photo_ids: ['3'], parent_id: 'outer' },
  { id: 'outer', photo_ids: ['4'], parent_id: 'top' },
  { id: 'top', photo_ids: [], parent_id: null },
]

describe('nested canvas groups', () => {
  it('anchors folded covers to saved coordinates regardless of decoded image dimensions', () => {
    const groups = [{ id: 'g', photo_ids: ['p'], collapsed: true }]
    const tiny = layoutCanvasGroups(groups, [{ id: 'p', x: 0, y: 0, width: 21, height: 21 }])[0]
    const fallback = layoutCanvasGroups(groups, [{ id: 'p', x: 0, y: 0, width: 212, height: 170 }])[0]
    expect(tiny.bounds).toEqual(fallback.bounds)
  })
  it('allows dropping into freed space while protecting the visible folded cover', () => {
    const items = [{ id: 'a', x: 0, y: 0, width: 100, height: 100 }, { id: 'b', x: 1000, y: 0, width: 100, height: 100 }]
    const groups = layoutCanvasGroups([{ id: 'g', photo_ids: ['a', 'b'], collapsed: true }], items)
    const obstacles = canvasDropObstacles(items, groups, 'loose')
    expect(findFreePosition({ x: 1000, y: 0, width: 100, height: 100 }, obstacles)).toEqual({ x: 1000, y: 0 })
    const cover = groups[0].bounds
    const point = { x: cover.left + cover.width / 2, y: cover.top + cover.height / 2 }
    expect(findFreePosition({ ...point, width: 100, height: 100 }, obstacles)).not.toEqual(point)
  })
  it('folds bounds without moving photos and hides descendants while retaining child state', () => {
    const items = ['1', '2', '3', '4'].map((id, i) => ({ id, x: i * 400, y: 0, width: 100, height: 100 }))
    const original = structuredClone(items)
    const folded = groups.map(group => ({ ...group, collapsed: ['top', 'a'].includes(group.id) }))
    const layout = layoutCanvasGroups(folded, items)
    const top = layout.find(group => group.id === 'top')
    expect(top.bounds.width).toBe(280)
    expect(top.bounds.height).toBe(200)
    expect(layout.find(group => group.id === 'a').hidden).toBe(true)
    expect(items).toEqual(original)
    const restored = layoutCanvasGroups(folded.map(group => ({ ...group, collapsed: group.id === 'top' ? false : group.collapsed })), items)
    expect(restored.find(group => group.id === 'a').collapsed).toBe(true)
    expect(restored.find(group => group.id === 'a').hidden).toBe(false)
    expect(restored.find(group => group.id === 'top').bounds.width).toBeGreaterThan(280)
  })
  it('drops deleted members before expanding group selection without waiting for a refresh', () => {
    const live = Array.from({ length: 499 }, (_, i) => String(i))
    const groups = [{ id: 'a', photo_ids: [...live, 'deleted'] }]
    const items = live.map(id => ({ id, x: 0, y: 0, width: 100, height: 100 }))
    const laidOut = layoutCanvasGroups(groups, items)
    const selected = expandGroupSelection(['0', 'loose'], laidOut)
    expect(selected.size).toBe(500)
    expect(selected.has('deleted')).toBe(false)
    expect(selected.has('loose')).toBe(true)
  })
  it('expands every level while preserving direct ownership and depth', () => {
    const result = expandCanvasGroups(groups)
    expect(result.find(group => group.id === 'top').photo_ids).toEqual(['4', '1', '2', '3'])
    expect(result.find(group => group.id === 'outer').child_group_ids).toEqual(['a', 'b'])
    expect(result.find(group => group.id === 'a').depth).toBe(2)
    expect(groups[2].photo_ids).toEqual(['4'])
  })
  it('selects and deselects the outermost block atomically and keeps loose items', () => {
    const expanded = expandCanvasGroups(groups)
    expect([...expandGroupSelection(['2', 'loose'], expanded)].sort()).toEqual(['1', '2', '3', '4', 'loose'])
    const selected = toggleGroupSelection(new Set(['loose']), '2', expanded)
    expect([...selected].sort()).toEqual(['1', '2', '3', '4', 'loose'])
    expect([...toggleGroupSelection(selected, '3', expanded)]).toEqual(['loose'])
  })
  it('never selects only part of a block when the selection limit is reached', () => {
    const expanded = expandCanvasGroups(groups)
    expect([...expandGroupSelection(['loose', '1'], expanded, 4)]).toEqual(['loose'])
    expect([...toggleGroupSelection(new Set(['loose']), '1', expanded, 4)]).toEqual(['loose'])
  })
  it('wraps child headings at each level and orders parents behind children', () => {
    const items = ['1', '2', '3', '4'].map((id, i) => ({ id, x: i * 200, y: 0, width: 100, height: 100 }))
    const laidOut = layoutCanvasGroups(groups, items)
    expect(laidOut[0].id).toBe('top')
    for (const group of laidOut.filter(group => group.parent_id)) {
      const parent = laidOut.find(item => item.id === group.parent_id)
      expect(group.bounds.top - parent.bounds.top).toBe(48)
      expect(group.bounds.left - parent.bounds.left).toBeGreaterThanOrEqual(16)
      expect(parent.bounds.top + parent.bounds.height - group.bounds.top - group.bounds.height).toBeGreaterThanOrEqual(16)
    }
  })
})
