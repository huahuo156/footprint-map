import { expect, it } from 'vitest'
import { prepareNotebookEntry } from '../src/journal/notebookImport'
import { cardBounds, intersects } from '../src/journal/model'

it('reserves non-overlapping page positions before uploading and preserves comments', () => {
  const input = new FormData()
  input.append('data', JSON.stringify({ components: [{ type: 'description', value: '风很温柔' }], photos: [{ upload_index: 0 }, { upload_index: 1 }] }))
  const result = prepareNotebookEntry(input, 'page', { trips: [], entries: [], marks: [] }, [{ width: 1000, height: 500 }, { width: 500, height: 1000 }])
  const values = JSON.parse(result.get('data'))
  expect(values.notebook_page_id).toBe('page')
  expect(values.components[0].value).toBe('风很温柔')
  const boxes = values.photos.map(photo => cardBounds({ x: photo.canvas_x, y: photo.canvas_y, width: 260, height: 340, rotation: 3 }))
  expect(intersects(boxes[0], boxes[1])).toBe(false)
})
