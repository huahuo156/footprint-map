import { describe, expect, it } from 'vitest'
import { buildCanvas, cardBounds, findFreePosition, groupByDay, intersects, itemsInRectangle, placeColor, planPhotoImport, zoomAt, photoDimensions, canvasGroupBounds } from '../src/journal/model'
import { materializeJournal } from '../src/journal/components'

describe('journal layout and navigation', () => {
  it('fits the complete image by its natural proportions without enlarging small images', () => {
    const wide = photoDimensions({ width: 1600, height: 800 }), tall = photoDimensions({ width: 600, height: 1200 })
    expect(wide.imageWidth / wide.imageHeight).toBe(2)
    expect(tall.imageWidth / tall.imageHeight).toBe(.5)
    expect(wide.width).toBeGreaterThan(tall.width)
    expect(tall.height).toBeGreaterThan(wide.height)
    expect(photoDimensions({ width: 80, height: 40 })).toMatchObject({ imageWidth: 80, imageHeight: 40 })
    expect(photoDimensions({ width: 0, height: 0 }).width).toBeGreaterThan(0)
  })
  it('wraps only surviving members with room for a heading and follows member movement', () => {
    const group = { photo_ids: ['a', 'b', 'deleted'] }
    const cards = [{ id: 'a', x: 0, y: 0, width: 100, height: 80 }, { id: 'b', x: 300, y: 100, width: 100, height: 80 }, { id: 'other', x: 9999, y: 9999 }]
    const before = canvasGroupBounds(group, cards)
    expect(before.left).toBeLessThanOrEqual(-50)
    expect(before.top).toBeLessThan(-40)
    expect(before.left + before.width).toBeGreaterThanOrEqual(350)
    const after = canvasGroupBounds(group, cards.map(card => ({ ...card, x: card.x + 75, y: card.y - 25 })))
    expect(after.left - before.left).toBe(75)
    expect(after.top - before.top).toBe(-25)
    expect(canvasGroupBounds({ photo_ids: [] }, cards)).toBeNull()
  })
  it('plans a large import around existing cards and keeps positioned photos fixed after metadata changes', () => {
    const planned = planPhotoImport(45, { x: 0, y: 0 }, [cardBounds({ x: 0, y: 0 })])
    planned.forEach((item, index) => expect([cardBounds({ x: 0, y: 0 }), ...planned.slice(0, index).map(card => cardBounds(card))].some(box => intersects(cardBounds(item), box))).toBe(false))
    const photo = { id: 'p', components: [{ type: 'trip', value: 'new' }], canvas_absolute: 1, canvas_x: 80, canvas_y: 0 }
    const model = buildCanvas(materializeJournal({ trips: [{ id: 'new', canvas_x: 900, canvas_y: 800 }], entries: [{ id: 'e', entry_date: '2026-01-01', photos: [photo] }] }))
    expect(model.items[0]).toMatchObject({ x: 80, y: 0, anchor: { x: 0, y: 0 } })
  })
  it('plans imports using actual portrait dimensions so pinned photos do not overlap after loading', () => {
    const dimensions = Array.from({ length: 4 }, () => ({ width: 600, height: 1200 }))
    const planned = planPhotoImport(4, { x: 0, y: 0 }, [], dimensions)
    const photos = planned.map((position, i) => ({ id: 'p' + i, url: '/portrait.png', components: [], canvas_absolute: true, canvas_x: position.x, canvas_y: position.y, rotation: position.rotation }))
    const { items } = buildCanvas(materializeJournal({ trips: [], entries: [{ id: 'e', entry_date: '2026-01-01', photos }] }), { '/portrait.png': dimensions[0] })
    items.forEach((item, i) => expect(items.slice(i + 1).some(other => intersects(cardBounds(item), cardBounds(other)))).toBe(false))
  })
  it('selects photos, text and stickers inside a marquee in either drag direction', () => {
    const items = [{ id: 'a', kind: 'photo', x: 0, y: 0 }, { id: 'b', kind: 'photo', x: 500, y: 0 }, { id: 'mark', kind: 'mark', x: 0, y: 0 }, { id: 'note', kind: 'entry', x: 0, y: 0 }]
    expect(itemsInRectangle(items, { x: 150, y: 150 }, { x: -150, y: -150 })).toEqual(['a', 'mark', 'note'])
    expect(itemsInRectangle(items, { x: -150, y: -150 }, { x: 650, y: 150 })).toEqual(['a', 'b', 'mark', 'note'])
  })
  it('keeps loose annotations visible without inventing a trip and avoids photos and each other', () => {
    const data = materializeJournal({ trips: [], entries: [], marks: [
      { id: 'text', kind: 'text', text: '慢慢走\n停一停', size: 'large', canvas_x: 0, canvas_y: 0, captured_on: '2026-05-01' },
      { id: 'sticker', kind: 'sticker', sticker: 'flower', size: 'large', canvas_x: 0, canvas_y: 0, captured_on: '2026-05-01' },
    ] })
    const model = buildCanvas(data)
    expect(model.groups).toHaveLength(0)
    expect(model.items.map(item => item.kind)).toEqual(['mark', 'mark'])
    expect(intersects(cardBounds(model.items[0]), cardBounds(model.items[1]))).toBe(false)
    expect(model.items[0].height).toBeGreaterThan(100)
    expect(groupByDay(data.entries)[0].entries).toHaveLength(2)
  })
  it('keeps the world point under the pointer fixed during zoom', () => {
    const before = { x: 70, y: -20, scale: .6 }, cursor = { x: 240, y: 110 }
    const after = zoomAt(before, 1.2, cursor)
    expect((cursor.x - after.x) / after.scale).toBeCloseTo((cursor.x - before.x) / before.scale)
    expect((cursor.y - after.y) / after.scale).toBeCloseTo((cursor.y - before.y) / before.scale)
  })
  it('moves dropped cards clear of rotated photos and reserved title areas', () => {
    const dragged = { x: 0, y: 0, rotation: 5 }, obstacles = [cardBounds({ x: 0, y: 0, rotation: -4 }), { x: 300, y: 0, w: 500, h: 80 }]
    const result = { ...dragged, ...findFreePosition(dragged, obstacles) }
    expect(obstacles.some(box => intersects(cardBounds(result), box))).toBe(false)
  })
  it('lays out many records and notes without covering names or each other', () => {
    const trips = [0, 1, 2].map(index => ({ id: 't' + index, canvas_x: index * 800, canvas_y: 0, name: '旅程' }))
    const entries = Array.from({ length: 48 }, (_, index) => ({ id: 'e' + index, trip_id: trips[index % 3].id, entry_date: '2026-05-01', caption: '一段记忆', photos: index % 4 ? [{ id: 'p' + index, rotation: index % 2 ? 4 : -4 }] : [] }))
    const { items, headers } = buildCanvas({ trips, entries })
    expect(items).toHaveLength(48)
    items.forEach((item, index) => expect([...headers, ...items.slice(0, index).map(card => cardBounds(card))].some(box => intersects(cardBounds(item), box))).toBe(false))
  })
  it('groups whole days without a time grid and keeps place colors stable', () => {
    const result = groupByDay([{ id: 1, entry_date: '2026-05-01' }, { id: 2, entry_date: '2026-05-03' }, { id: 3, entry_date: '2026-05-01' }])
    expect(result.map(day => day.date)).toEqual(['2026-05-03', '2026-05-01'])
    expect(result[1].entries.map(entry => entry.id)).toEqual([1, 3])
    expect(placeColor('西湖')).not.toBe(placeColor('乌镇'))
    expect(placeColor('乌镇')).not.toBe(placeColor('上海'))
  })
})
