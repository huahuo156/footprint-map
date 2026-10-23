import { findPagePosition, pageItems } from './notebooks'

export function prepareNotebookEntry(body, pageId, data, dimensions = []) {
  const values = JSON.parse(body.get('data')), existing = pageItems(data, pageId), sizes = {}
  const photos = values.photos.map((p, i) => {
    const url = 'notebook-upload-' + i
    if (dimensions[p.upload_index]) sizes[url] = dimensions[p.upload_index]
    return { ...p, id: 'pending-' + i, url, components: p.components ?? values.components }
  })
  const pendingEntry = { ...values, id: 'pending-entry', entry_date: '2026-01-01', photos }
  const placements = photos.length ? photos.map((p, i) => ({ id: p.id, kind: 'photo', page_id: pageId, x: 600, y: 800, rotation: i % 2 ? 3 : -3 })) : [{ id: pendingEntry.id, kind: 'entry', page_id: pageId, x: 600, y: 800 }]
  const pending = pageItems({ trips: [], entries: [pendingEntry], notebook_items: placements }, pageId, sizes)
  for (const [i, item] of pending.entries()) {
    // Reserve the largest ordinary photo footprint so decoding after save cannot overlap neighbours.
    const reserved = item.kind === 'photo' ? { ...item, width: Math.max(280, item.width), height: Math.max(350, item.height) } : item
    const position = findPagePosition(reserved, existing, { x: 340 + i % 2 * 500, y: 330 + Math.floor(i / 2) * 400 })
    existing.push({ ...reserved, ...position })
    if (photos.length) Object.assign(values.photos[i], { canvas_x: position.x, canvas_y: position.y })
    else Object.assign(values, { canvas_x: position.x, canvas_y: position.y })
  }
  values.notebook_page_id = pageId
  body.set('data', JSON.stringify(values))
  return body
}
