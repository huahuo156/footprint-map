import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useJournal } from '../src/journal/useJournal'
import * as api from '../src/lib/api'

vi.mock('../src/lib/api', () => ({ captureApiSession: () => () => {}, fetchJournal: vi.fn(), saveJournalLayout: vi.fn(), saveNotebook: vi.fn() }))
let data
beforeEach(() => {
  vi.clearAllMocks()
  data = { trips: [], marks: [], notebooks: [{ id: 'book', canvas_x: 0, canvas_y: 0 }], entries: [{ id: 'e', entry_date: '2026-10-27', components: [], photos: [{ id: 'p', url: '/p', components: [], canvas_absolute: 1, canvas_x: 0, canvas_y: 0 }] }], canvas_groups: [{ id: 'g', photo_ids: ['p'], collapsed: true }] }
  api.fetchJournal.mockImplementation(async () => structuredClone(data))
  api.saveJournalLayout.mockImplementation(async changes => {
    for (const change of changes) Object.assign(data.entries[0].photos.find(p => p.id === change.id), { canvas_x: change.x, canvas_y: change.y, canvas_absolute: 1, rotation: change.rotation })
  })
})
afterEach(cleanup)

it('persists automatic repair through the existing layout API and does not write again on reload', async () => {
  const { result } = renderHook(() => useJournal())
  await waitFor(() => expect(result.current.loading).toBe(false))
  const stored = data.entries[0].photos[0]
  expect(Math.abs(stored.canvas_x) >= 283 || Math.abs(stored.canvas_y) >= 283).toBe(true)
  expect(result.current.data.entries[0].photos[0].canvas_x).toBe(stored.canvas_x)
  expect(api.saveJournalLayout).toHaveBeenCalledTimes(1)
  await act(async () => { await result.current.reload() })
  expect(api.saveJournalLayout).toHaveBeenCalledTimes(1)
})

it('reports a failed repair and allows retry without pretending its position was saved', async () => {
  api.saveJournalLayout.mockRejectedValueOnce(new Error('网络中断'))
  const { result } = renderHook(() => useJournal())
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.error).toContain('自动避让')
  expect(result.current.data.entries[0].photos[0].canvas_x).toBe(0)
  await act(async () => { await result.current.reload() })
  expect(result.current.error).toBe('')
  const stored = data.entries[0].photos[0]
  expect(Math.abs(stored.canvas_x) >= 283 || Math.abs(stored.canvas_y) >= 283).toBe(true)
})
