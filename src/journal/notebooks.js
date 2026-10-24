import { materializeJournal } from './components'
import { buildCanvas, cardBounds, intersects } from './model'

export const PAGE_WIDTH = 1200
export const PAGE_HEIGHT = 1600
export const itemKey = item => `${item.kind}:${item.id}`

export function canvasData(data) {
  const materialized = materializeJournal(data)
  const assigned = new Set((data.notebook_items || []).map(itemKey))
  const entries = materialized.entries.flatMap(entry => {
    if (entry.mark) return assigned.has(`mark:${entry.mark.id}`) ? [] : [entry]
    if (!entry.photos.length) return assigned.has(`entry:${entry.id}`) ? [] : [entry]
    const photos = entry.photos.filter(photo => !assigned.has(`photo:${photo.id}`))
    return photos.length ? [{ ...entry, photos }] : []
  })
  const remaining = new Set(entries.flatMap(entry => entry.photos.map(photo => photo.id)))
  return { ...materialized, entries, canvas_groups: (data.canvas_groups || []).map(group => ({ ...group, photo_ids: (group.photo_ids || []).filter(id => remaining.has(id)), ...(group.direct_photo_ids ? { direct_photo_ids: group.direct_photo_ids.filter(id => remaining.has(id)) } : {}) })) }
}

export function pageItems(data, pageId, imageSizes = {}) {
  const placements = new Map((data.notebook_items || []).filter(item => item.page_id === pageId).map(item => [itemKey(item), item]))
  const entries = materializeJournal(data).entries.flatMap(entry => {
    if (entry.mark) return placements.has(`mark:${entry.mark.id}`) ? [entry] : []
    if (!entry.photos.length) return placements.has(`entry:${entry.id}`) ? [entry] : []
    const photos = entry.photos.filter(photo => placements.has(`photo:${photo.id}`))
    return photos.length ? [{ ...entry, photos }] : []
  })
  return buildCanvas({ trips: [], entries }, imageSizes).items.map(item => {
    const placement = placements.get(itemKey(item))
    const result = { ...item, x: placement.x, y: placement.y, rotation: placement.rotation || 0, anchor: { x: 0, y: 0 } }
    // Preserve the image proportions while reserving all visible component text.
    const components = item.entry.components
    const text = components ? components.map(part => typeof part.value === 'string' ? part.value : part.value?.name || '').join('') : item.entry.caption || ''
    if (item.kind === 'photo') {
      // Stable footprint covers the largest decoded image (240px) and captions.
      // Both insertion and later decoding must measure the same occupied space.
      const lines = Math.ceil(text.length / 18)
      const extra = Math.max(0, lines - 2) * 22 + Math.max(0, (components?.length || 0) - 2) * 28
      result.layoutWidth = 560
      result.layoutHeight = (350 + extra) * 2
      result.height = item.height + extra
    } else if (item.kind === 'entry') {
      result.width = 212
      result.height = Math.max(236, 70 + Math.ceil(text.length / 12) * 24 + (components?.length || 0) * 28)
    }
    // One paper page is larger than the canvas viewport; enlarge the same content
    // uniformly, including typography, while retaining its original renderer.
    result.contentScale = 2
    result.width = (result.width || 212) * 2
    result.height = (result.height || 236) * 2
    return result
  })
}

export function findPagePosition(item, existingItems, preferred = { x: 600, y: 800 }) {
  // Normalize rotation for the shared AABB helper (which expects an acute angle).
  const bounds = value => cardBounds({ ...value, width: value.layoutWidth || value.width, height: value.layoutHeight || value.height, rotation: ((value.rotation || 0) % 180 + 180) % 180 > 90 ? 180 - ((value.rotation || 0) % 180 + 180) % 180 : ((value.rotation || 0) % 180 + 180) % 180 })
  const box = bounds(item), obstacles = existingItems.map(bounds)
  const minX = box.w / 2, maxX = PAGE_WIDTH - minX, minY = box.h / 2, maxY = PAGE_HEIGHT - minY
  if (minX > maxX || minY > maxY) throw new Error('这一页已经放不下这项内容，请添加新页。')
  const x = Math.max(minX, Math.min(maxX, preferred.x)), y = Math.max(minY, Math.min(maxY, preferred.y))
  // Obstacle edges supply exact-fit candidates as well as a regular search grid.
  const xs = new Set([x, minX, maxX]), ys = new Set([y, minY, maxY])
  for (const obstacle of obstacles) {
    xs.add(obstacle.x - (obstacle.w + box.w) / 2); xs.add(obstacle.x + (obstacle.w + box.w) / 2)
    ys.add(obstacle.y - (obstacle.h + box.h) / 2); ys.add(obstacle.y + (obstacle.h + box.h) / 2)
  }
  const candidates = [...xs].filter(cx => cx >= minX && cx <= maxX).flatMap(cx => [...ys].filter(cy => cy >= minY && cy <= maxY).map(cy => ({ x: cx, y: cy }))).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))
  for (const candidate of candidates) if (!obstacles.some(obstacle => intersects({ ...box, ...candidate }, obstacle))) return candidate
  throw new Error('这一页已经放不下这项内容，请添加新页。')
}
