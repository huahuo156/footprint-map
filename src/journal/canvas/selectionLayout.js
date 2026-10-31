import { cardBounds, intersects, isCanvasSticker } from '../model.js'
import { canvasObstacles, groupCard } from '../canvasCollision.js'
import { snapshotLayoutPositions } from './history.js'

export function layoutPosition(item, delta = { x: 0, y: 0 }) {
  return snapshotLayoutPositions([{
    id: item.kind === 'entry' ? item.entry?.record_id || item.id : item.id,
    kind: item.kind,
    x: item.x + delta.x - (item.kind === 'photo' ? 0 : item.anchor?.x || 0),
    y: item.y + delta.y - (item.kind === 'photo' ? 0 : item.anchor?.y || 0),
    rotation: item.rotation || 0,
  }])[0]
}

function selection(scene, ids) {
  const values = Array.from(ids), chosen = new Set(values)
  if (!values.length || values.length > 500 || chosen.size !== values.length) throw new Error('选择已变化，请重新选择内容')
  const items = scene.items.filter(item => chosen.has(item.id))
  if (items.length !== chosen.size || new Set(items.map(item => item.id)).size !== chosen.size) throw new Error('选择已变化，请重新选择内容')
  items.forEach(item => layoutPosition(item))
  const roots = (scene.groups || []).filter(group => !group.parent_id && group.photo_ids.some(id => chosen.has(id)))
  if (roots.some(group => group.hidden || !group.photo_ids.every(id => chosen.has(id)))) throw new Error('请完整选择色块分组')
  const grouped = new Set(roots.flatMap(group => group.photo_ids))
  return { items, blocks: [...roots.map(group => ({ ...groupCard(group), grouped: true })), ...items.filter(item => !grouped.has(item.id))] }
}

export function planSelectionMove(scene, ids, delta) {
  if (![delta?.x, delta?.y].every(Number.isFinite)) throw new Error('无效的移动距离')
  const { items, blocks } = selection(scene, ids)
  const positions = snapshotLayoutPositions(items.map(item => layoutPosition(item, delta)))
  const obstacles = canvasObstacles(scene, items.map(item => item.id))
  if (blocks.some(block => !isCanvasSticker(block) && obstacles.some(obstacle => intersects(cardBounds({ ...block, x: block.x + delta.x, y: block.y + delta.y }), obstacle)))) throw new Error('当前位置受其他内容阻挡')
  return positions
}

export function selectionCamera(scene, ids, viewport) {
  if (![viewport?.width, viewport?.height].every(value => Number.isFinite(value) && value > 0)) throw new Error('画布尚未就绪')
  const boxes = selection(scene, ids).blocks.map(item => cardBounds(item))
  const left = Math.min(...boxes.map(box => box.x - box.w / 2)), right = Math.max(...boxes.map(box => box.x + box.w / 2))
  const top = Math.min(...boxes.map(box => box.y - box.h / 2)), bottom = Math.max(...boxes.map(box => box.y + box.h / 2))
  const scale = Math.max(.08, Math.min(1, Math.max(1, viewport.width - 160) / (right - left), Math.max(1, viewport.height - 160) / (bottom - top)))
  return { scale, x: -(left + right) / 2 * scale || 0, y: -(top + bottom) / 2 * scale || 0, detail: true }
}
