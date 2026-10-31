import { cardBounds } from './model'

export const ATLAS_MAP_SCALE = 1.65
export const ATLAS_PERSPECTIVE = 1400
export const ATLAS_MAP_BOUNDS = { x: 550, y: 390, w: 850, h: 595 }

export function atlasSceneBounds(cards) {
  const boxes = [ATLAS_MAP_BOUNDS, ...cards.map(card => cardBounds(card, 24))]
  const halfWidth = Math.max(...boxes.map(box => Math.abs(box.x - 550) + box.w / 2)) + 32
  const halfHeight = Math.max(...boxes.map(box => Math.abs(box.y - 390) + box.h / 2)) + 32
  return { width: halfWidth * 2, height: halfHeight * 2, bottom: 390 + halfHeight }
}

export function atlasTilt(zoom) {
  const progress = Math.max(0, Math.min(1, (zoom - 1) / 1.2))
  // CSS rotateX(0) is parallel to the screen. Zooming in must reduce the
  // foreshortening, rather than increasing the angle and flattening the map.
  return 20 * (1 - progress * progress * (3 - 2 * progress))
}

export function projectAtlasPoint(point, tilt) {
  const angle = tilt * Math.PI / 180
  const x = (point.x - 550) * ATLAS_MAP_SCALE, y = (point.y - 390) * ATLAS_MAP_SCALE
  const perspective = ATLAS_PERSPECTIVE / (ATLAS_PERSPECTIVE - y * Math.sin(angle))
  return { x: 550 + x * perspective, y: 390 + y * Math.cos(angle) * perspective }
}

