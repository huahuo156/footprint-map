import { markDimensions } from '../../shared/journal-marks'
import { hasComponentContent } from '../../shared/journal-components'
import { expandCanvasGroups } from '../../shared/journal-groups.js'

export const PALETTES = ['sage', 'sand', 'sky', 'rose', 'lavender']
export const CANVAS_GROUP_METRICS = { padding: 16, header: 48, minWidth: 280, coverWidth: 280, coverHeight: 200 }
export const SPOTS = [
  { key: 'bridge', name: '断桥 · 湖岸', lat: 30.2596, lng: 120.1517 },
  { key: 'island', name: '三潭印月 · 湖中', lat: 30.2368, lng: 120.1443 },
  { key: 'tower', name: '雷峰塔 · 南岸', lat: 30.2301, lng: 120.1487 },
  { key: 'causeway', name: '苏堤 · 湖上', lat: 30.2475, lng: 120.1352 },
]
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const imageFilter = filter => filter === 'film' ? 'sepia(.2) saturate(.78) contrast(1.04)' : filter === 'mono' ? 'grayscale(1)' : 'none'
export const isWestLake = entry => /西湖/.test(entry.place_name || '')
export function dayLabel(value) {
  const date = new Date(value + 'T12:00:00')
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 · 周${'日一二三四五六'[date.getDay()]}`
}
export function groupByDay(entries) {
  const groups = new Map()
  for (const entry of entries) {
    if (!groups.has(entry.entry_date)) groups.set(entry.entry_date, [])
    groups.get(entry.entry_date).push(entry)
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a)).map(([date, items]) => ({ date, entries: items }))
}
export function placeColor(place, fallback = 'sage') {
  if (/湖|山|公园/.test(place || '')) return 'sage'
  if (/镇|古城|故宫/.test(place || '')) return 'sand'
  if (/上海|海|江|城市/.test(place || '')) return 'sky'
  if (!place) return fallback
  return PALETTES[[...place].reduce((sum, c) => sum + c.charCodeAt(0), 0) % PALETTES.length]
}
export const intersects = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2
export function photoDimensions(size, bare = true) {
  const valid = Number.isFinite(size?.width) && Number.isFinite(size?.height) && size.width > 0 && size.height > 0
  const scale = valid ? Math.min(1, 240 / size.width, 240 / size.height) : 1
  const imageWidth = valid ? size.width * scale : 192, imageHeight = valid ? size.height * scale : 150
  return { imageWidth, imageHeight, width: Math.max(bare ? 0 : 160, imageWidth + 20), height: imageHeight + (bare ? 20 : 86) }
}
export function canvasGroupBounds(group, items) {
  const { padding, header } = CANVAS_GROUP_METRICS
  const ids = new Set(group.photo_ids), boxes = items.filter(item => ids.has(item.id)).map(item => cardBounds(item, 0))
  if (!boxes.length) return null
  const left = Math.min(...boxes.map(box => box.x - box.w / 2)) - padding
  const top = Math.min(...boxes.map(box => box.y - box.h / 2)) - header
  return { left, top, width: Math.max(...boxes.map(box => box.x + box.w / 2)) + padding - left, height: Math.max(...boxes.map(box => box.y + box.h / 2)) + padding - top }
}
export function layoutCanvasGroups(groups, items) {
  const { padding, header, minWidth, coverWidth, coverHeight } = CANVAS_GROUP_METRICS
  const liveIds = new Set(items.map(item => item.id))
  const expanded = expandCanvasGroups(groups.map(group => ({ ...group, direct_photo_ids: (group.direct_photo_ids || group.photo_ids || []).filter(id => liveIds.has(id)) }))).sort((a, b) => b.depth - a.depth)
  const bounds = new Map()
  for (const group of expanded) {
    const own = canvasGroupBounds({ photo_ids: group.direct_photo_ids }, items)
    const children = group.child_group_ids.map(id => bounds.get(id)).filter(Boolean)
    const boxes = [...(own ? [own] : []), ...children.map(box => ({ left: box.left - padding, top: box.top - header, width: box.width + padding * 2, height: box.height + header + padding }))]
    if (!boxes.length) continue
    const left = Math.min(...boxes.map(box => box.left)), top = Math.min(...boxes.map(box => box.top))
    const members = items.filter(item => group.photo_ids.includes(item.id))
    group.bounds = group.collapsed ? { left: Math.min(...members.map(item => item.x)) - coverWidth / 2, top: Math.min(...members.map(item => item.y)) - coverHeight / 2, width: coverWidth, height: coverHeight } : { left, top, width: Math.max(minWidth, Math.max(...boxes.map(box => box.left + box.width)) - left), height: Math.max(...boxes.map(box => box.top + box.height)) - top }
    bounds.set(group.id, group.bounds)
  }
  const byId = new Map(expanded.map(group => [group.id, group]))
  for (const group of expanded) {
    let parent = byId.get(group.parent_id)
    group.hidden = false
    while (parent) {
      if (parent.collapsed) { group.hidden = true; break }
      parent = byId.get(parent.parent_id)
    }
  }
  return expanded.filter(group => group.bounds).sort((a, b) => a.depth - b.depth)
}
export function canvasDropObstacles(items, groups, excludedId) {
  const hidden = new Set(groups.filter(group => group.collapsed).flatMap(group => group.photo_ids))
  return [
    ...items.filter(item => item.id !== excludedId && !hidden.has(item.id)).map(item => cardBounds(item)),
    ...groups.filter(group => group.collapsed && !group.hidden).map(group => ({ x: group.bounds.left + group.bounds.width / 2, y: group.bounds.top + group.bounds.height / 2, w: group.bounds.width + 18, h: group.bounds.height + 18 })),
  ]
}
export function cardBounds(item, margin = 18) {
  const angle = Math.abs(item.rotation || 0) * Math.PI / 180
  const width = item.width || 212, height = item.height || 236
  return { x: item.x, y: item.y, w: width * Math.cos(angle) + height * Math.sin(angle) + margin, h: height * Math.cos(angle) + width * Math.sin(angle) + margin }
}
export function findFreePosition(item, obstacles) {
  if (!obstacles.some(box => intersects(cardBounds(item), box))) return { x: item.x, y: item.y }
  for (let radius = 24; radius <= 4800; radius += 24) {
    const steps = Math.max(12, Math.ceil(radius / 16))
    for (let i = 0; i < steps; i++) {
      const angle = i / steps * Math.PI * 2
      const candidate = { ...item, x: item.x + Math.cos(angle) * radius, y: item.y + Math.sin(angle) * radius }
      if (!obstacles.some(box => intersects(cardBounds(candidate), box))) return { x: candidate.x, y: candidate.y }
    }
  }
  return { x: item.x + 10000, y: item.y }
}
export function buildCanvas(data, imageSizes = {}) {
  const groups = [], items = [], headers = [], occupiedGroups = []
  const records = data.entries.filter(entry => !entry.mark)
  const known = new Set(data.trips.map(trip => trip.id)), loose = records.filter(entry => !known.has(entry.trip_id))
  const allTrips = [...data.trips, ...(loose.length ? [{ id: 'loose-memories', name: '随手留下', color: 'sage', canvas_x: data.trips.length ? -800 : 0, canvas_y: data.trips.length ? -700 : 0, ungrouped: true }] : [])]
  for (const [index, trip] of allTrips.entries()) {
    const entries = (trip.ungrouped ? loose : records.filter(entry => entry.trip_id === trip.id)).slice().sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.id.localeCompare(b.id))
    const cards = entries.flatMap(entry => entry.photos.length ? entry.photos.map(photo => ({ ...photo, kind: 'photo', entry, color: trip.color })) : [{ id: entry.id, kind: 'entry', entry, color: trip.color, canvas_x: entry.canvas_x, canvas_y: entry.canvas_y, rotation: entry.rotation }])
    const columns = Math.min(6, Math.max(2, Math.ceil(Math.sqrt(cards.length || 1))))
    const rows = Math.max(1, Math.ceil(cards.length / columns)), width = Math.max(600, columns * 290), height = rows * 290 + 125
    let anchor = { x: trip.canvas_x ?? index * 800, y: trip.canvas_y ?? 0 }
    while (occupiedGroups.some(box => intersects({ ...anchor, w: width + 140, h: height + 140 }, box))) anchor = { ...anchor, y: anchor.y + 80 }
    occupiedGroups.push({ ...anchor, w: width + 140, h: height + 140 })
    const header = { x: anchor.x, y: anchor.y - rows * 145 - 75, w: width, h: 75 }
    headers.push(header)
    groups.push({ ...trip, ...anchor, width, height, header, entries, cardCount: cards.length, covers: cards.filter(card => card.kind === 'photo').slice(0, 3) })
    cards.forEach((card, i) => {
      if (card.kind === 'photo') Object.assign(card, photoDimensions(imageSizes[card.url], card.entry.components != null && !card.entry.components.some(hasComponentContent)))
      const row = Math.floor(i / columns), column = i % columns
      const origin = card.canvas_absolute ? { x: 0, y: 0 } : anchor
      items.push({ ...card, trip_id: trip.id, anchor: origin, x: origin.x + (card.canvas_x ?? (column - (columns - 1) / 2) * 290 + (row % 2 ? 12 : -6)), y: origin.y + (card.canvas_y ?? (row - (rows - 1) / 2) * 290 + (column % 2 ? 12 : -6)), rotation: card.rotation ?? (i % 2 ? 3 : -3) })
    })
  }
  for (const entry of data.entries.filter(entry => entry.mark)) {
    const mark = entry.mark
    items.push({ ...mark, ...markDimensions(mark), kind: 'mark', entry, anchor: { x: 0, y: 0 }, x: mark.canvas_x, y: mark.canvas_y })
  }
  const pinned = items.filter(item => item.kind === 'photo' && item.canvas_absolute)
  const headerObstacles = pinned.map(item => cardBounds(item))
  for (const header of headers) {
    Object.assign(header, findFreePosition({ ...header, width: header.w, height: header.h }, headerObstacles))
    headerObstacles.push(header)
  }
  const obstacles = [...headers, ...pinned.map(item => cardBounds(item))]
  for (const item of items) {
    if (item.kind === 'photo' && item.canvas_absolute) continue
    Object.assign(item, findFreePosition(item, obstacles))
    obstacles.push(cardBounds(item))
  }
  return { groups, items, headers }
}
export function zoomAt(camera, scale, point) {
  const ratio = scale / camera.scale
  return { ...camera, scale, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio }
}
export function planPhotoImport(count, center, obstacles = [], dimensions = []) {
  const columns = Math.min(24, Math.ceil(Math.sqrt(count))), rows = Math.ceil(count / columns), occupied = [...obstacles]
  return Array.from({ length: count }, (_, index) => {
    // Reserve the caption space too, so later metadata edits fit the initial layout.
    const item = { ...photoDimensions(dimensions[index], false), x: center.x + (index % columns - (columns - 1) / 2) * 290, y: center.y + (Math.floor(index / columns) - (rows - 1) / 2) * 290, rotation: index % 2 ? 3 : -3 }
    Object.assign(item, findFreePosition(item, occupied)); occupied.push(cardBounds(item))
    return item
  })
}
export function itemsInRectangle(items, a, b) {
  const rectangle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }
  return items.filter(item => intersects(cardBounds(item, 0), rectangle)).map(item => item.id)
}
