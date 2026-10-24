import { describe, expect, it } from 'vitest'
import { planGroupExpansion } from '../src/journal/groupExpansion.js'
import { layoutCanvasGroups } from '../src/journal/model.js'

const photo = (id, x, y = 0, rotation = 0) => ({ id, kind: 'photo', x, y, rotation, width: 100, height: 100 })
const expanded = (id, groups, items, positions) => layoutCanvasGroups(groups.map(group => group.id === id ? { ...group, collapsed: false } : group), items.map(item => ({ ...item, ...positions.find(position => position.id === item.id) })))
function expectSeparated(a, b, gap = 18) {
  expect(a.left + a.width + gap <= b.left || b.left + b.width + gap <= a.left || a.top + a.height + gap <= b.top || b.top + b.height + gap <= a.top).toBe(true)
}

describe('planning group expansion', () => {
  it('separates nested siblings by translating every selected descendant together', () => {
    const groups = [
      { id: 'parent', photo_ids: [] },
      { id: 'a', parent_id: 'parent', photo_ids: ['p'], collapsed: true },
      { id: 'nested', parent_id: 'a', photo_ids: ['n'] },
      { id: 'b', parent_id: 'parent', photo_ids: ['q'] },
    ]
    const items = [photo('p', 0, 0, 4), photo('n', 400, 30, -3), photo('q', 500)]
    const before = structuredClone({ groups, items })
    const positions = planGroupExpansion('a', groups, items)
    expect(positions.map(position => position.id).sort()).toEqual(['n', 'p'])
    expect(positions.every(position => position.kind === 'photo')).toBe(true)
    const p = positions.find(position => position.id === 'p'), n = positions.find(position => position.id === 'n')
    expect(n.x - p.x).toBeCloseTo(400)
    expect(n.y - p.y).toBeCloseTo(30)
    expect([p.rotation, n.rotation]).toEqual([4, -3])
    const layout = expanded('a', groups, items, positions)
    expectSeparated(layout.find(group => group.id === 'a').bounds, layout.find(group => group.id === 'b').bounds)
    expect({ groups, items }).toEqual(before)
  })

  it('separates root siblings whose saved photos extend beyond their folded cover', () => {
    const groups = [{ id: 'a', photo_ids: ['p', 'n'], collapsed: true }, { id: 'b', photo_ids: ['q'] }]
    const items = [photo('p', 0), photo('n', 600), photo('q', 500)]
    const positions = planGroupExpansion('a', groups, items)
    expect(positions).toHaveLength(2)
    const layout = expanded('a', groups, items, positions)
    expectSeparated(layout.find(group => group.id === 'a').bounds, layout.find(group => group.id === 'b').bounds)
  })

  it('includes nested group header padding when detecting collisions', () => {
    const groups = [{ id: 'a', photo_ids: [], collapsed: true }, { id: 'nested', parent_id: 'a', photo_ids: ['p'] }, { id: 'b', photo_ids: ['q'] }]
    const items = [photo('p', 0), photo('q', 0, -240)]
    const positions = planGroupExpansion('a', groups, items)
    expect(positions).toHaveLength(1)
    const layout = expanded('a', groups, items, positions)
    expectSeparated(layout.find(group => group.id === 'a').bounds, layout.find(group => group.id === 'b').bounds)
  })

  it('ignores ancestor bounds that must contain the expanded child', () => {
    const groups = [{ id: 'parent', photo_ids: [] }, { id: 'a', parent_id: 'parent', photo_ids: ['p'], collapsed: true }]
    expect(planGroupExpansion('a', groups, [photo('p', 0)])).toEqual([])
  })

  it('uses the visible folded sibling cover instead of its hidden photo extent', () => {
    const groups = [{ id: 'a', photo_ids: ['p'], collapsed: true }, { id: 'b', photo_ids: ['q', 'hidden'], collapsed: true }]
    expect(planGroupExpansion('a', groups, [photo('p', 0, 1000), photo('q', 1000), photo('hidden', 0, 1000)])).toEqual([])
  })

  it('keeps collapsed descendants as blocks while moving their hidden members', () => {
    const groups = [{ id: 'a', photo_ids: [], collapsed: true }, { id: 'nested', parent_id: 'a', photo_ids: ['p', 'n'], collapsed: true }, { id: 'b', photo_ids: ['q'] }]
    const items = [photo('p', 0), photo('n', 10000), photo('q', 100)]
    const positions = planGroupExpansion('a', groups, items)
    expect(positions).toHaveLength(2)
    expect(positions[1].x - positions[0].x).toBeCloseTo(10000)
    const layout = expanded('a', groups, items, positions)
    expectSeparated(layout.find(group => group.id === 'a').bounds, layout.find(group => group.id === 'b').bounds)
  })

  it('moves touching bounds to leave a margin and keeps already separated bounds still', () => {
    const groups = [{ id: 'a', photo_ids: ['p'], collapsed: true }, { id: 'b', photo_ids: ['q'] }]
    expect(planGroupExpansion('a', groups, [photo('p', 0), photo('q', 320)])).toHaveLength(1)
    expect(planGroupExpansion('a', groups, [photo('p', 0), photo('q', 338)])).toEqual([])
  })

  it('avoids unrelated visible cards even without a sibling group', () => {
    const groups = [{ id: 'a', photo_ids: ['p'], collapsed: true }]
    const items = [photo('p', 0), photo('loose', 100)]
    const positions = planGroupExpansion('a', groups, items)
    expect(positions).toHaveLength(1)
    const bounds = expanded('a', groups, items, positions)[0].bounds
    expectSeparated(bounds, { left: 50, top: -50, width: 100, height: 100 })
  })

  it('still separates very wide saved groups when the nearby search is exhausted', () => {
    const groups = [{ id: 'a', photo_ids: ['p', 'n'], collapsed: true }, { id: 'b', photo_ids: ['q', 'r'] }]
    const items = [photo('p', 0), photo('n', 30000), photo('q', 10000, -10000), photo('r', 10000, 10000)]
    const positions = planGroupExpansion('a', groups, items)
    const layout = expanded('a', groups, items, positions)
    expectSeparated(layout.find(group => group.id === 'a').bounds, layout.find(group => group.id === 'b').bounds)
  })

  it('ignores missing groups and groups hidden below a collapsed ancestor', () => {
    const groups = [{ id: 'parent', photo_ids: [], collapsed: true }, { id: 'a', parent_id: 'parent', photo_ids: ['p'], collapsed: true }]
    expect(planGroupExpansion('missing', groups, [photo('p', 0)])).toEqual([])
    expect(planGroupExpansion('a', groups, [photo('p', 0), photo('loose', 0)])).toEqual([])
  })
})
