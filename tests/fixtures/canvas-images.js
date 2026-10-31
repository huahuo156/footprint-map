// Deterministic synthetic content only; never reads a user's image directory.
export function imageDimensions(index) {
  return index % 3 === 0 ? { width: 512, height: 320 } : index % 3 === 1 ? { width: 320, height: 512 } : { width: 512, height: 512 }
}
export function imagePixels(index) {
  const { width, height } = imageDimensions(index), pixels = Buffer.alloc(width * height * 3)
  let random = (index + 1) * 2654435761 >>> 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    random ^= random << 13; random ^= random >>> 17; random ^= random << 5
    const noise = (random >>> 0) % 31, offset = (y * width + x) * 3
    pixels[offset] = (45 + x * 150 / width + noise + index % 23) & 255
    pixels[offset + 1] = (55 + y * 130 / height + noise + index % 31) & 255
    pixels[offset + 2] = (145 + (x + y) * 65 / (width + height) + noise) & 255
  }
  return pixels
}
export function createCanvasFixture(count) {
  if (!Number.isInteger(count) || count < 8 || count > 2000) throw new RangeError('Fixture count must be 8–2000')
  const columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns)
  const photos = Array.from({ length: count }, (_, index) => ({
    id: `perf-photo-${index}`, url: `/uploads/perf-image-${index}.webp`, components: [], canvas_absolute: 1,
    canvas_x: (index % columns - (columns - 1) / 2) * 450, canvas_y: (Math.floor(index / columns) - (rows - 1) / 2) * 500,
    rotation: index % 7 === 0 ? 3 : 0, layout_version: '0',
  }))
  const id = index => photos[index].id
  return {
    structure_version: '0', trips: [], marks: [], notebooks: [], notebook_pages: [], notebook_items: [],
    entries: [{ id: 'perf-photo-record', entry_date: '2026-10-31', title: 'Synthetic performance fixture', components: [], photos, layout_version: '0' },
      ...Array.from({ length: 3 }, (_, index) => ({ id: `perf-text-${index}`, entry_date: '2026-10-31', caption: 'Synthetic text '.repeat(20), photos: [], canvas_x: index * 500, canvas_y: rows * 500 / 2 + 800, rotation: 0, layout_version: '0' }))],
    canvas_groups: [
      { id: 'perf-outer', name: '性能外层', photo_ids: [id(0), id(1)], collapsed: false, color: 'sand' },
      { id: 'perf-inner', name: '性能内层', parent_id: 'perf-outer', photo_ids: [id(columns), id(columns + 1)], collapsed: false, color: 'sage' },
      { id: 'perf-folded', name: '性能折叠', photo_ids: photos.slice(count < 10 ? -2 : -4).map(photo => photo.id), collapsed: true, color: 'sky' },
    ],
  }
}
