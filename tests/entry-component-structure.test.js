// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
const state = vi.hoisted(() => ({ connection: null }))
vi.mock('../server/db.js', () => ({ pool: { getConnection: async () => state.connection } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner' }))
vi.mock('../server/asset-lifecycle.js', () => ({ reclaimAssets: async () => {}, collectUnusedAssets: async () => {} }))
import { createJournalRouter } from '../server/journal.js'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const tripA = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const tripB = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
let listener
afterEach(async () => { if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null } })
async function request(body, { entry, photos = [] } = {}) {
  const run = vi.fn(async (sql, args) => {
    expect(args).toContain('owner')
    if (sql.includes('FROM journal_layout_state')) return [[{ structure_version: '3' }]]
    if (sql.startsWith('DELETE FROM journal_notebook_entry_items')) return [{ affectedRows: 0 }]
    if (sql.includes('FROM journal_entries WHERE id=?')) return [[entry]]
    if (sql.startsWith('SELECT * FROM journal_photos')) return [photos]
    if (sql.includes('FROM journal_trips')) return [[{ id: args[0] }]]
    return [{ affectedRows: 1 }]
  })
  const connection = { execute: run, query: run, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }
  state.connection = connection
  const app = express(); app.use(express.json()); app.use(createJournalRouter('unused'))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }))
  listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve))
  const result = await fetch(`http://127.0.0.1:${listener.address().port}/entries/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { result, connection }
}
const entry = (components = null) => ({ id, trip_id: null, components, entry_date: '2026-10-30', captured_on: '2026-10-30' })
const photo = components => ({ id, components, sort_order: 0, url: '/journal-demo/fixture.jpg' })
it('increments the structure version when a photo date component changes', async () => {
  const { result, connection } = await request({ title: 'content', entry_date: '2026-10-30', photos: [{ id, components: [{ type: 'date', value: '2026-10-30' }] }] }, { entry: entry([{ type: 'date', value: '2026-10-29' }]), photos: [photo([{ type: 'date', value: '2026-10-29' }])] })
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it('increments the structure version when a photo trip component changes', async () => {
  const { result, connection } = await request({ title: 'content', entry_date: '2026-10-30', photos: [{ id, components: [{ type: 'trip', value: tripB }] }] }, { entry: entry([{ type: 'trip', value: tripA }]), photos: [photo([{ type: 'trip', value: tripA }])] })
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it('does not increment the structure version when photo components are unchanged', async () => {
  const components = [{ type: 'date', value: '2026-10-30' }, { type: 'trip', value: tripA }]
  const { result, connection } = await request({ title: 'content', entry_date: '2026-10-30', components, photos: [{ id, components }] }, { entry: entry(components), photos: [photo(components)] })
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toBe(false)
})
it('increments the structure version when a photoless entry date component changes', async () => {
  const { result, connection } = await request({ title: 'content', entry_date: '2026-10-30', photos: [], components: [{ type: 'date', value: '2026-10-30' }] }, { entry: entry([{ type: 'date', value: '2026-10-29' }]), photos: [] })
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it('does not increment the structure version when a photoless entry keeps the same effective structure', async () => {
  const components = [{ type: 'date', value: '2026-10-30' }]
  const { result, connection } = await request({ title: 'content', entry_date: '2026-10-30', photos: [], components }, { entry: entry(components), photos: [] })
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toBe(false)
})
