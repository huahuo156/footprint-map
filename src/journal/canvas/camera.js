// Pointer client coordinates and getBoundingClientRect share the same origin.
// Camera translation is in viewport pixels; world positions are unscaled.
export function viewportPoint(point, bounds) {
  return { x: point.x - bounds.left - bounds.width / 2, y: point.y - bounds.top - bounds.height / 2 }
}

export function screenToWorld(point, bounds, camera) {
  const local = viewportPoint(point, bounds)
  return { x: (local.x - camera.x) / camera.scale, y: (local.y - camera.y) / camera.scale }
}

export function worldToScreen(point, bounds, camera) {
  return { x: bounds.left + bounds.width / 2 + camera.x + point.x * camera.scale, y: bounds.top + bounds.height / 2 + camera.y + point.y * camera.scale }
}

export function zoomAt(camera, scale, point) {
  const ratio = scale / camera.scale
  return { ...camera, scale, x: point.x - (point.x - camera.x) * ratio, y: point.y - (point.y - camera.y) * ratio }
}
