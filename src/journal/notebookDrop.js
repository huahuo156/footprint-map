import { findPagePosition, itemKey, PAGE_WIDTH, PAGE_HEIGHT } from './notebooks'

// Keep the original grab offset, using rendered bounds to account for zoom.
export function notebookDragPosition(item, source, target, start, point) {
  return {
    x: (source.left + item.x / PAGE_WIDTH * source.width + point.x - start.x - target.left) / target.width * PAGE_WIDTH,
    y: (source.top + item.y / PAGE_HEIGHT * source.height + point.y - start.y - target.top) / target.height * PAGE_HEIGHT,
  }
}

export function planNotebookDrop(incoming, existing, preferred) {
  const keys = new Set(incoming.map(itemKey)), stationary = existing.filter(item => !keys.has(itemKey(item)))
  try {
    const occupied = [...stationary], result = []
    for (const item of incoming) {
      const placed = { ...item, ...findPagePosition(item, occupied, preferred) }
      occupied.push(placed); result.push(placed)
    }
    return result
  } catch {
    // A central card can block every candidate although the page fits two cards.
    // Repack the whole page only when preserving the old arrangement cannot work.
    const result = []
    for (const item of [...stationary, ...incoming]) result.push({ ...item, ...findPagePosition(item, result, { x: 0, y: 0 }) })
    return result
  }
}

export function notebookDropPage(point) {
  // Pointer capture and the dragged card can hide the paper from elementFromPoint.
  // Only live spread pages count: animation snapshots must never receive content.
  return [...document.querySelectorAll('.nb-reader .nb-spread [data-notebook-page]')].find(paper => {
    const bounds = paper.getBoundingClientRect()
    return bounds.width > 0 && bounds.height > 0 && point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
  }) || null
}
