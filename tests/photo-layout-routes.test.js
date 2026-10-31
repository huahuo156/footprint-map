// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
const state = vi.hoisted(() => ({ connection: null }))
vi.mock('../server/db.js', () => ({ pool: { getConnection: async () => state.connection } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner' }))
import { createJournalRouter } from '../server/journal.js'
const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
let listener
afterEach(async () => { if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null } })
const defaultPhotos = () => [a, b].map(id => ({ id, components: [], entry_components: null, canvas_x: 0, canvas_y: 0, rotation: 0, canvas_absolute: 1, trip_id: null, entry_date: '2026-10-30', captured_on: '2026-10-30' }))
async function request(body, versions = ['4', '5'], photos = defaultPhotos()) {
  const run = vi.fn(async (sql, args) => {
    expect(args).toContain('owner')
    if (sql.includes('FROM journal_layout_state')) return [[{ structure_version: '3' }]]
    if (sql.includes('FROM journal_trips')) return [[{ id: args[0] }]]
    if (sql.startsWith('SELECT CAST') && sql.includes('journal_photos') || sql.startsWith('SELECT rotation')) return [[{ layout_version: versions.shift() }]]
    if (sql.startsWith('SELECT DISTINCT')) return [[{ entry_id: a }]]
    if (sql.startsWith('SELECT p.*')) return [photos]
    return [{ affectedRows: 1 }]
  })
  const connection = { execute: run, query: run, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }
  state.connection = connection
  const app = express(); app.use(express.json()); app.use(createJournalRouter('unused'))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }))
  listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve))
  const result = await fetch(`http://127.0.0.1:${listener.address().port}/photos/components`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { result, connection }
}
const base = { photo_ids: [a, b], components: [{ type: 'description', value: 'updated' }] }
const positions = () => [{ id: a, x: 10, y: 20, expected_version: '4' }, { id: b, x: 30, y: 40, expected_version: '5' }]
it('increments layout versions for legacy positioned writes', async () => {
  const { result, connection } = await request({ ...base, positions: positions().map(({ expected_version: _expectedVersion, ...position }) => position) })
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.includes('layout_version=layout_version+1'))).toHaveLength(2)
})
it('checks both tokens before conditional writes', async () => {
  const { result, connection } = await request({ ...base, positions: positions(), expected_structure_version: '3' })
  expect(result.status).toBe(200)
  expect(connection.commit).toHaveBeenCalledOnce()
})
it.each(['structure', 'row'])('rejects stale %s without partial writes', async kind => {
  const { result, connection } = await request({ ...base, positions: positions(), expected_structure_version: kind === 'structure' ? '2' : '3' }, ['4', '9'])
  expect(result.status).toBe(409)
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
  expect(connection.rollback).toHaveBeenCalledOnce()
})
it('does not increment layout versions for pure content', async () => {
  const { result, connection } = await request(base)
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.some(([sql]) => sql.includes('layout_version=layout_version+1'))).toBe(false)
})
it('does not increment the structure version for unchanged structural components', async () => {
  const photos = defaultPhotos()
  for (const photo of photos) photo.components = [{ type: 'trip', value: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }, { type: 'date', value: '2026-10-30' }]
  const { result, connection } = await request({ photo_ids: [a, b], components: [{ type: 'trip', value: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }, { type: 'date', value: '2026-10-30' }] }, ['4', '5'], photos)
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toBe(false)
})
it('increments the structure version when a photo trip component changes', async () => {
  const photos = defaultPhotos()
  photos[0].components = [{ type: 'trip', value: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }]
  const { result, connection } = await request({ photo_ids: [a, b], components: [{ type: 'trip', value: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }] }, ['4', '5'], photos)
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it('increments the structure version when a photo date component changes', async () => {
  const photos = defaultPhotos()
  photos[0].components = [{ type: 'date', value: '2026-10-29' }]
  const { result, connection } = await request({ photo_ids: [a, b], components: [{ type: 'date', value: '2026-10-30' }] }, ['4', '5'], photos)
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it.each([undefined, '3'])('rejects mixed or unpaired versions (%s)', async structure => {
  const items = positions(); if (structure) delete items[1].expected_version
  const { result } = await request({ ...base, positions: items, expected_structure_version: structure })
  expect(result.status).toBe(400)
})
