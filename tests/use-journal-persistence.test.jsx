import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ journal: null, pending: [], fetch: vi.fn(), request: vi.fn() }))
vi.mock('../src/lib/api', () => ({ captureApiSession: () => () => {}, fetchJournal: (...args) => mock.fetch(...args), request: (...args) => mock.request(...args), saveNotebookReading: vi.fn() }))
vi.mock('../src/journal/canvasCollision', async original => ({ ...await original(), planCanvasRepair: () => ({ items: [], notebooks: [] }) }))
import { useJournal } from '../src/journal/useJournal'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const p = x => ({ kind: 'mark', id, x, y: 0, rotation: 0 })
beforeEach(() => {
  mock.journal = { structure_version: '3', trips: [], entries: [], marks: [{ id, kind: 'text', text: 'fixture', size: 'medium', canvas_x: 0, canvas_y: 0, rotation: 0, captured_on: '2026-10-30', layout_version: '0' }], notebooks: [], notebook_pages: [], notebook_items: [], canvas_groups: [] }
  mock.pending = []; mock.fetch.mockReset().mockImplementation(async () => structuredClone(mock.journal))
  mock.request.mockReset().mockImplementation((path, options) => {
    if (path === '/journal/layout') return new Promise((resolve, reject) => mock.pending.push({ body: JSON.parse(options.body), signal: options.signal, resolve: data => {
      const sent = mock.pending.find(entry => entry.body.items.some(item => data.items.some(saved => saved.id === item.id && item.expected_version === String(BigInt(saved.layout_version) - 1n))))?.body.items || []
      for (const item of data.items) {
        const original = sent.find(value => value.id === item.id)
        const rows = item.kind === 'photo' ? mock.journal.entries.flatMap(entry => entry.photos) : mock.journal.marks
        Object.assign(rows.find(row => row.id === item.id), { layout_version: item.layout_version, ...(original ? { canvas_x: original.x, canvas_y: original.y, rotation: original.rotation, ...(item.kind === 'photo' ? { canvas_absolute: 1 } : {}) } : {}) })
      }
      resolve(data)
    }, reject }))
    if (path === '/journal/marks/' + id && options.method === 'DELETE') { mock.journal.marks = []; mock.journal.structure_version = '4'; return Promise.resolve({ deleted: id }) }
    throw new Error('Unexpected request ' + path)
  })
})
it('preserves failed layout and blocks reload/deletion until exact retry succeeds', async () => {
  const { result } = renderHook(() => useJournal('account-a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => { result.current.saveLayouts([p(10)]) })
  await waitFor(() => expect(mock.pending).toHaveLength(1))
  expect(mock.pending[0].body).toMatchObject({ expected_structure_version: '3', items: [{ ...p(10), expected_version: '0' }] })
  await act(async () => mock.pending[0].reject(new Error('offline')))
  expect(result.current.data.marks[0].canvas_x).toBe(10)
  expect(result.current.layout.status).toBe('failed')
  const reads = mock.fetch.mock.calls.length
  await expect(result.current.reload()).rejects.toThrow(); await expect(result.current.deleteMark(id)).rejects.toThrow()
  expect(mock.fetch).toHaveBeenCalledTimes(reads); expect(mock.request).toHaveBeenCalledTimes(1)
  act(() => result.current.layout.retryLayout()); await waitFor(() => expect(mock.pending).toHaveLength(2))
  expect(mock.pending[1].body).toEqual(mock.pending[0].body)
  await act(async () => mock.pending[1].resolve({ saved: 1, items: [{ kind: 'mark', id, layout_version: '1' }] }))
  await act(async () => result.current.deleteMark(id))
  expect(result.current.data.marks).toEqual([]); expect(result.current.layout.canUndo).toBe(false)
  const [, options] = mock.request.mock.calls.at(-1); expect(JSON.parse(options.body).expected_structure_version).toBe('3')
})
it('warns on navigation with an unconfirmed layout', async () => {
  const { result, unmount } = renderHook(() => useJournal('account-a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => {
    result.current.saveLayouts([p(10)])
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
  })
  await waitFor(() => expect(mock.pending).toHaveLength(1))
  unmount(); expect(mock.pending[0].signal.aborted).toBe(true)
})
it('does not expose the old account layout after session switching', async () => {
  const { result, rerender } = renderHook(({ user }) => useJournal(user), { initialProps: { user: 'a' } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => { result.current.saveLayouts([p(10)]) }); await waitFor(() => expect(mock.pending).toHaveLength(1))
  mock.journal.marks = []
  rerender({ user: 'b' }); expect(result.current.data.marks).toEqual([])
  await waitFor(() => expect(result.current.loading).toBe(false)); expect(mock.pending[0].signal.aborted).toBe(true)
})
it('does not let an older initial read replace a newer refresh baseline', async () => {
  const resolvers = []
  mock.fetch.mockImplementation(() => new Promise(resolve => resolvers.push(resolve)))
  const { result } = renderHook(() => useJournal('account-a'))
  await waitFor(() => expect(resolvers).toHaveLength(1))
  let second
  act(() => { second = result.current.reload() })
  await waitFor(() => expect(resolvers).toHaveLength(2))
  const newer = structuredClone(mock.journal); newer.marks[0].canvas_x = 20
  await act(async () => { resolvers[1](newer); await second })
  await act(async () => resolvers[0](structuredClone(mock.journal)))
  expect(result.current.data.marks[0].canvas_x).toBe(20)
})
it('undoes a first move of a relative photo to its visual starting position', async () => {
  const trip = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  mock.journal.marks = []; mock.journal.trips = [{ id: trip, name: 'trip', canvas_x: 800, canvas_y: 0 }]
  mock.journal.entries = [{ id: 'entry', trip_id: trip, entry_date: '2026-10-30', photos: [{ id, url: '/fixture.jpg', canvas_x: 10, canvas_y: 0, rotation: 0, canvas_absolute: 0, layout_version: '0' }] }]
  const { result } = renderHook(() => useJournal('a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.data.entries[0].photos[0].canvas_absolute).toBe(0)
  act(() => result.current.saveLayouts([{ ...p(820), kind: 'photo' }]))
  await waitFor(() => expect(mock.pending).toHaveLength(1))
  expect(mock.pending[0].body.items[0].x).toBe(820)
  await act(async () => mock.pending[0].reject(new Error('offline')))
  act(() => result.current.layout.undoLayout())
  expect(result.current.data.entries[0].photos[0].canvas_x).toBe(10)
  act(() => result.current.layout.retryLayout()); await waitFor(() => expect(mock.pending).toHaveLength(2))
  await act(async () => mock.pending[1].resolve({ saved: 1, items: [{ kind: 'photo', id, layout_version: '1' }] }))
  await waitFor(() => expect(mock.pending).toHaveLength(3))
  expect(mock.pending[2].body.items[0]).toMatchObject({ x: 810, expected_version: '1' })
  await act(async () => mock.pending[2].resolve({ saved: 1, items: [{ kind: 'photo', id, layout_version: '2' }] }))
  expect(result.current.data.entries[0].photos[0]).toMatchObject({ canvas_x: 810, canvas_absolute: 1 })
})
it('requires explicit discard for a known conflict and clears history after refresh', async () => {
  const { result } = renderHook(() => useJournal('a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.saveLayouts([p(10)])); await waitFor(() => expect(mock.pending).toHaveLength(1))
  await act(async () => mock.pending[0].reject(Object.assign(new Error('conflict'), { status: 409 })))
  const reads = mock.fetch.mock.calls.length
  await expect(result.current.reload()).rejects.toThrow(); expect(mock.fetch).toHaveBeenCalledTimes(reads)
  mock.journal.marks[0].canvas_x = 30; mock.journal.marks[0].layout_version = '1'; mock.journal.structure_version = '4'
  await act(async () => result.current.reload({ discard: true }))
  expect(result.current.data.marks[0].canvas_x).toBe(30); expect(result.current.layout.canUndo).toBe(false)
})
it('refuses explicit discard while a failed request has an unknown outcome', async () => {
  const { result } = renderHook(() => useJournal('a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.saveLayouts([p(10)]))
  await waitFor(() => expect(mock.pending).toHaveLength(1))
  await act(async () => mock.pending[0].reject(new Error('response lost')))
  const reads = mock.fetch.mock.calls.length
  await expect(result.current.reload({ discard: true })).rejects.toThrow()
  expect(mock.fetch).toHaveBeenCalledTimes(reads)
  expect(result.current.data.marks[0].canvas_x).toBe(10)
  expect(result.current.layout.canRetry).toBe(true)
})
it('retains a conflict draft after a failed refresh and clears the leave warning only after recovery', async () => {
  const { result } = renderHook(() => useJournal('a'))
  await waitFor(() => expect(result.current.loading).toBe(false))
  act(() => result.current.saveLayouts([p(10)]))
  await waitFor(() => expect(mock.pending).toHaveLength(1))
  await act(async () => mock.pending[0].reject(Object.assign(new Error('conflict'), { status: 409 })))
  mock.fetch.mockRejectedValueOnce(new Error('refresh offline'))
  await act(async () => { await expect(result.current.reload({ discard: true })).rejects.toThrow('refresh offline') })
  expect(result.current.data.marks[0].canvas_x).toBe(10)
  expect(result.current.layout.conflict).toBe(true)
  let event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
  mock.journal.marks[0].canvas_x = 30; mock.journal.marks[0].layout_version = '1'
  await act(async () => result.current.reload({ discard: true }))
  expect(result.current.data.marks[0].canvas_x).toBe(30)
  expect(result.current.layout.canUndo).toBe(false)
  event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
})
