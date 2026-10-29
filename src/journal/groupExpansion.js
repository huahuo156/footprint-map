import { layoutCanvasGroups } from './model.js'
import { collisionItems, planCanvasGroupMove } from './canvasCollision.js'

export function reserveUndecodedPhotos(items) {
  return collisionItems(items)
}

// Plan against the visible expanded rectangle, then move the entire subtree as
// one block. Ancestors contain this rectangle and must never be obstacles.
export function planGroupExpansion(groupId, groups, items, notebooks = [], headers = []) {
  const layout = layoutCanvasGroups(groups.map(group => group.id === groupId ? { ...group, collapsed: false } : group), items)
  const target = layout.find(group => group.id === groupId)
  if (!target || target.hidden) return []

  const positions = planCanvasGroupMove(groupId, { items, groups: layout, notebooks, headers })
  return positions.some(position => { const item = items.find(item => item.id === position.id); return Math.abs(position.x - item.x) > .0001 || Math.abs(position.y - item.y) > .0001 }) ? positions : []
}
