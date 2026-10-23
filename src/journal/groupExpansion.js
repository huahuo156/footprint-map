import { cardBounds, findFreePosition, intersects, layoutCanvasGroups } from './model.js'

export function reserveUndecodedPhotos(items, imageSizes) {
  return items.map(item => item.kind === 'photo' && !imageSizes[item.url] ? { ...item, width: Math.max(280, item.width || 0), height: Math.max(350, item.height || 0) } : item)
}

const groupBox = ({ left, top, width, height }) => ({ x: left + width / 2, y: top + height / 2, width, height, rotation: 0 })

// Plan against the visible expanded rectangle, then move the entire subtree as
// one block. Ancestors contain this rectangle and must never be obstacles.
export function planGroupExpansion(groupId, groups, items) {
  const layout = layoutCanvasGroups(groups.map(group => group.id === groupId ? { ...group, collapsed: false } : group), items)
  const target = layout.find(group => group.id === groupId)
  if (!target || target.hidden) return []

  const memberIds = new Set(target.photo_ids)
  const ancestors = new Set()
  const byId = new Map(layout.map(group => [group.id, group]))
  for (let parent = byId.get(target.parent_id); parent; parent = byId.get(parent.parent_id)) ancestors.add(parent.id)

  const blocks = layout.filter(group => group.id !== groupId && !group.hidden && !ancestors.has(group.id)
    && !group.photo_ids.some(id => memberIds.has(id))
    && (group.parent_id === target.parent_id || group.collapsed))
  const hiddenIds = new Set(layout.filter(group => group.collapsed).flatMap(group => group.photo_ids))
  const blockIds = new Set(blocks.flatMap(group => group.photo_ids))
  const obstacles = [
    ...blocks.map(group => cardBounds(groupBox(group.bounds))),
    ...items.filter(item => !memberIds.has(item.id) && !hiddenIds.has(item.id) && !blockIds.has(item.id)).map(item => cardBounds(item)),
  ]
  const block = groupBox(target.bounds)
  const position = findFreePosition(block, obstacles)
  // The generic card search has a finite radius and a fixed fallback. A saved
  // group can be much wider, so verify that fallback before accepting it.
  if (obstacles.some(obstacle => intersects(cardBounds({ ...block, ...position }), obstacle))) {
    position.x = Math.max(...obstacles.map(obstacle => obstacle.x + obstacle.w / 2)) + (block.width + 18) / 2
    position.y = block.y
  }
  const dx = position.x - block.x, dy = position.y - block.y
  if (!dx && !dy) return []
  return items.filter(item => memberIds.has(item.id)).map(item => ({ id: item.id, kind: 'photo', x: item.x + dx, y: item.y + dy, rotation: item.rotation || 0 }))
}
