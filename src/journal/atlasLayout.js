import boundary from '../data/china-boundary.json'
import regions from '../data/china-places.json'
import { cardBounds, intersects } from './model'
import { projectPlace, regionForPlace } from './atlasGeography'
export { projectPlace } from './atlasGeography'

export const ATLAS_PAGE_SIZE = 12
const polygons = boundary.features.flatMap(feature => feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates])
export const chinaPaths = polygons.map(polygon => polygon.map(ring => ring.map(([lng, lat], i) => {
  const point = projectPlace(lng, lat)
  return `${i ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
}).join(' ') + ' Z').join(' '))

function insideRing(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function coordinates(place) {
  if (place?.lat == null || place?.lng == null || place.lat === '' || place.lng === '') return null
  const lat = Number(place.lat), lng = Number(place.lng)
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}
const normalize = name => String(name || '').replace(/[\s·]/g, '')
const shortRegion = name => name.replace(/(?:维吾尔自治区|壮族自治区|回族自治区|特别行政区|自治区|省|市)$/, '')
const regionNames = new Map()
for (const region of regions) {
  const names = new Set([region.name, shortRegion(region.name)])
  if (region.parent) for (const parent of [region.parent, shortRegion(region.parent)]) for (const name of [region.name, shortRegion(region.name)]) names.add(parent + name)
  for (const name of names) regionNames.set(name, [...(regionNames.get(name) || []), region])
}
function resolvePlace(entry, landmarks) {
  const direct = coordinates(entry)
  if (direct) return direct
  const name = normalize(entry.place_name)
  if (!name && entry.landmark_id == null) return null
  const byId = entry.landmark_id == null ? null : landmarks.find(place => String(place.id) === String(entry.landmark_id))
  const matches = landmarks.filter(place => [place.name, place.city, `${place.province || ''}${place.city || ''}`, `${place.province || ''}${place.name || ''}`].some(value => normalize(value) === name))
  const exact = matches.length === 1 ? matches[0] : null
  // Only accept a unique partial match; short or ambiguous names stay unpinned.
  const candidates = name.length >= 2 ? landmarks.filter(place => normalize(place.name).includes(name)) : []
  const landmark = coordinates(byId)
  if (landmark) return landmark
  const administrative = regionNames.get(name)
  if (administrative?.length === 1) {
    const region = administrative[0]
    return { lng: region.center[0], lat: region.center[1], locationHint: region.parent || [110000, 120000, 310000, 500000].includes(region.code) ? '城市中心位置' : '地区中心位置' }
  }
  return coordinates(exact || (candidates.length === 1 ? candidates[0] : null))
}
export function atlasPhotos(data, landmarks = []) {
  const result = { located: [], unlocated: [], loose: [] }
  for (const entry of data.entries) for (const photo of entry.photos || []) {
    const item = { entry, photo, name: entry.place_name?.trim() || '' }, position = resolvePlace(entry, landmarks)
    if (position && polygons.some(polygon => insideRing(position.lng, position.lat, polygon[0]) && !polygon.slice(1).some(hole => insideRing(position.lng, position.lat, hole)))) {
      const region = regionForPlace(position)
      // Coincident coordinates share one pin, even when names or landmark IDs differ.
      const placeKey = `geo:${position.lng.toFixed(3)},${position.lat.toFixed(3)}`
      result.located.push({ ...item, ...region, placeKey, position, point: projectPlace(position.lng, position.lat), locationHint: position.locationHint || '', pinColor: region.province?.pinColor || '#a9cbb1' })
    } else if (item.name || position || entry.landmark_id != null) result.unlocated.push(item)
    else result.loose.push(item)
  }
  return result
}

export function settleAtlasPosition(item, others, point, bounds, avoidMap = false) {
  const obstacles = others.map(other => cardBounds(other, 12))
  if (avoidMap) obstacles.push({ x: 550, y: 390, w: 500, h: 350 })
  function free(x, y) {
    const box = cardBounds({ ...item, x, y }, 12)
    const withinBounds = !bounds || box.x - box.w / 2 >= 8 && box.x + box.w / 2 <= bounds.width - 8 && box.y - box.h / 2 >= 8 && box.y + box.h / 2 <= bounds.height - 8
    return withinBounds && !obstacles.some(obstacle => intersects(box, obstacle))
  }
  if (free(point.x, point.y)) return point
  for (let radius = 18; radius <= (bounds ? Math.max(bounds.width, bounds.height) : 2200); radius += 18) {
    const steps = Math.max(16, Math.ceil(radius / 14))
    for (let i = 0; i < steps; i++) {
      const x = point.x + Math.cos(i / steps * Math.PI * 2) * radius, y = point.y + Math.sin(i / steps * Math.PI * 2) * radius
      if (free(x, y)) return { x, y }
    }
  }
  return { x: item.x, y: item.y }
}

export function layoutScatter(items, imageSizes = {}, saved = {}, unbounded = false) {
  const placed = [], bounds = { width: 1100, height: 600 + Math.ceil(items.length / 3) * 340 }
  const cards = items.map((item, i) => {
    const size = imageSizes[item.photo.id], ratio = size?.width > 0 && size?.height > 0 ? size.width / size.height : [1.3, .8, 1.5, .95][i % 4]
    const imageWidth = Math.min([220, 200, 236, 208][i % 4], 250 * ratio), imageHeight = imageWidth / ratio
    const angle = i * 2.399963, radius = 120 * Math.sqrt(i)
    return { ...item, width: imageWidth + 20, height: imageHeight + 20 + (item.name ? 30 : 0), rotation: item.photo.rotation || [-5, 3, -2, 5, 1, -4][i % 6], x: 550 + Math.cos(angle) * radius * 1.35, y: Math.max(290, 140 * Math.sqrt(items.length)) + Math.sin(angle) * radius }
  })
  for (const item of [...cards].sort((a, b) => Number(!!saved[b.photo.id]) - Number(!!saved[a.photo.id]))) {
    const position = saved[item.photo.id]
    Object.assign(item, settleAtlasPosition(item, placed, position || item, unbounded ? null : bounds))
    placed.push(item)
  }
  return cards
}

export function layoutAtlas(items, saved = {}) {
  const slots = [
    [210, 110], [448, 108], [655, 112], [890, 110],
    [1000, 305], [1000, 495],
    [885, 690], [650, 688], [445, 692], [210, 690],
    [100, 495], [100, 305],
  ].map(([x, y]) => ({ x, y }))
  // Match the nearest available slot to each pin. Slots reserve the full card,
  // including captions, so even photos at the same location cannot collide.
  const cards = items.slice(0, ATLAS_PAGE_SIZE).map((item, i) => {
    let best = 0, distance = Infinity
    slots.forEach((slot, index) => {
      const next = Math.hypot(slot.x - item.point.x, slot.y - item.point.y)
      if (next < distance) { distance = next; best = index }
    })
    return { ...item, ...slots.splice(best, 1)[0], width: 166, height: 172, rotation: [-2, 1, -1, 2, -1, 1][i % 6] }
  })
  const placed = []
  for (const card of [...cards].sort((a, b) => Number(!!saved[b.photo.id]) - Number(!!saved[a.photo.id]))) {
    Object.assign(card, settleAtlasPosition(card, placed, saved[card.photo.id] || card, saved[card.photo.id] ? null : { width: 1100, height: 800 }, true))
    placed.push(card)
  }
  return cards
}
