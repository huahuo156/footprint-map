import { buildCanvas, cardBounds, findFreePosition, intersects, isCanvasSticker, isWestLake, layoutCanvasGroups, PHOTO_COLLISION_SIZE } from './model.js'
import { canvasData } from './notebooks.js'

export const notebookCard = book => ({ ...book, kind: 'notebook', x: book.canvas_x ?? 0, y: book.canvas_y ?? 0, width: 250, height: 330 })
export const groupCard = group => ({ x: group.bounds.left + group.bounds.width / 2, y: group.bounds.top + group.bounds.height / 2, width: group.bounds.width, height: group.bounds.height, rotation: 0 })
export const canvasHeaders = model => model.groups.filter(group => !group.ungrouped && group.entries.some(isWestLake)).map(group => group.header)

export function canvasObstacles({ items = [], groups = [], notebooks = [], headers = [] }, excludedIds = []) {
  const excluded = new Set(excludedIds)
  const visibleGroups = groups.filter(group => !group.hidden && !group.photo_ids.some(id => excluded.has(id)))
  const covered = new Set(visibleGroups.flatMap(group => group.photo_ids))
  const hidden = new Set(groups.filter(group => group.collapsed).flatMap(group => group.photo_ids))
  return [
    ...headers,
    ...notebooks.filter(book => !excluded.has(book.id)).map(book => cardBounds(notebookCard(book))),
    ...visibleGroups.map(group => cardBounds(groupCard(group))),
    ...items.filter(item => !excluded.has(item.id) && !hidden.has(item.id) && !covered.has(item.id) && !isCanvasSticker(item)).map(item => cardBounds(item)),
  ]
}

export function placeCanvasItem(item, scene) {
  if (isCanvasSticker(item)) return { x: item.x, y: item.y }
  const original = scene.items.find(other => other.id === item.id) || item
  return hierarchyPosition(item.kind === 'notebook' ? { ...item, width: 250, height: 330 } : item, scene, [item.id], original)
}

export function planCanvasGroupMove(groupId, scene, delta = { x: 0, y: 0 }) {
  const group = scene.groups.find(group => group.id === groupId)
  if (!group || group.hidden) return []
  const block = groupCard(group), desired = { ...block, x: block.x + delta.x, y: block.y + delta.y }
  const position = hierarchyPosition(desired, scene, group.photo_ids, block)
  const dx = position.x - block.x, dy = position.y - block.y
  return scene.items.filter(item => group.photo_ids.includes(item.id)).map(item => ({ id: item.id, kind: item.kind, x: item.x + dx, y: item.y + dy, rotation: item.rotation || 0 }))
}

// A stable reservation is shared by loaded images, imports and reload repair.
export function collisionItems(items) {
  return items.map(item => item.kind === 'photo' ? { ...item, width: Math.max(PHOTO_COLLISION_SIZE.width, item.width || 0), height: Math.max(PHOTO_COLLISION_SIZE.height, item.height || 0) } : item)
}

function hierarchyPosition(desired, scene, memberIds, original) {
  const moved = new Set(memberIds), obstacles = canvasObstacles(scene, memberIds)
  const ancestors = scene.groups.filter(group => !group.hidden && group.photo_ids.some(id => moved.has(id)) && group.photo_ids.some(id => !moved.has(id)))
  if (!ancestors.length) return findFreePosition(desired, obstacles)
  const external = new Map(ancestors.map(group => [group.id, canvasObstacles(scene, group.photo_ids)]))
  const pending = [{ x: desired.x, y: desired.y }, { x: original.x, y: original.y }], seen = new Set()
  for (let attempt = 0; pending.length && attempt < 256; attempt++) {
    pending.sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y))
    const point = pending.shift()
    let bounds = cardBounds({ ...desired, ...point }), obstacle = obstacles.find(box => intersects(bounds, box))
    if (!obstacle) {
      const dx = point.x - original.x, dy = point.y - original.y
      const updated = layoutCanvasGroups(scene.groups, scene.items.map(item => moved.has(item.id) ? { ...item, x: item.x + dx, y: item.y + dy } : item))
      for (const ancestor of ancestors) {
        bounds = cardBounds(groupCard(updated.find(group => group.id === ancestor.id)))
        obstacle = external.get(ancestor.id).find(box => intersects(bounds, box))
        if (obstacle) break
      }
      if (!obstacle) return point
    }
    // Project the changed ancestor's edges too; its stationary descendants are
    // never translated. Recompute its union at each candidate before accepting.
    const dx = (bounds.w + obstacle.w) / 2 + .001, dy = (bounds.h + obstacle.h) / 2 + .001
    for (const next of [{ x: point.x + obstacle.x - dx - bounds.x, y: point.y }, { x: point.x + obstacle.x + dx - bounds.x, y: point.y }, { x: point.x, y: point.y + obstacle.y - dy - bounds.y }, { x: point.x, y: point.y + obstacle.y + dy - bounds.y }]) {
      const key = `${next.x.toFixed(3)},${next.y.toFixed(3)}`
      if (!seen.has(key)) { seen.add(key); pending.push(next) }
    }
  }
  return { x: original.x, y: original.y }
}

export function planCanvasRepair(data, previous) {
  // Lightweight consumers may omit empty collections; the API normally returns
  // them all. Keep planning tolerant without changing their returned data.
  const complete = value => ({ ...value, trips: value.trips || [], entries: (value.entries || []).map(entry => ({ ...entry, photos: entry.photos || [] })) })
  data = complete(data)
  const model = buildCanvas(canvasData(data), {}, false)
  const items = collisionItems(model.items), groups = layoutCanvasGroups(data.canvas_groups || [], items)
  const roots = groups.filter(group => !group.parent_id)
  const grouped = new Set(roots.flatMap(group => group.photo_ids))
  const blocks = [
    ...(data.notebooks || []).map(book => ({ ...notebookCard(book), key: `notebook:${book.id}` })),
    ...roots.map(group => ({ ...groupCard(group), key: `group:${group.id}`, group })),
    ...items.filter(item => !grouped.has(item.id) && !isCanvasSticker(item)).map(item => ({ ...item, key: `${item.kind}:${item.id}`, item })),
  ]
  if (previous) {
    previous = complete(previous)
    const old = buildCanvas(canvasData(previous), {}, false)
    const existing = new Set([...(previous.notebooks || []).map(book => `notebook:${book.id}`), ...(previous.canvas_groups || []).map(group => `group:${group.id}`), ...old.items.map(item => `${item.kind}:${item.id}`)])
    blocks.sort((a, b) => Number(existing.has(b.key)) - Number(existing.has(a.key)))
  }
  const occupied = [...canvasHeaders(model)], changes = { items: [], notebooks: [] }
  for (const block of blocks) {
    const position = findFreePosition(block, occupied)
    occupied.push(cardBounds({ ...block, ...position }))
    const dx = position.x - block.x, dy = position.y - block.y
    if (Math.abs(dx) < .0001 && Math.abs(dy) < .0001) continue
    if (block.kind === 'notebook') { changes.notebooks.push({ id: block.id, canvas_x: position.x, canvas_y: position.y }); continue }
    const members = block.group ? model.items.filter(item => block.group.photo_ids.includes(item.id)) : [block.item]
    for (const item of members) changes.items.push({ id: item.kind === 'entry' ? item.entry.record_id || item.id : item.id, kind: item.kind, x: item.x + dx - (item.kind === 'photo' ? 0 : item.anchor.x), y: item.y + dy - (item.kind === 'photo' ? 0 : item.anchor.y), rotation: item.rotation || 0 })
  }
  return changes
}
