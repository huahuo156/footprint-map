// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
const state = vi.hoisted(() => ({ connection: null }))
vi.mock('../server/db.js', () => ({ pool: { getConnection: async () => state.connection, execute: (...args) => state.connection.execute(...args) } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner' }))
vi.mock('../server/asset-lifecycle.js', () => ({ reclaimAssets: async () => {}, collectUnusedAssets: async () => {} }))
import { createJournalRouter } from '../server/journal.js'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
let listener
afterEach(async () => { if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null } })
async function request(route, method, body) {
  const run = vi.fn(async (sql, args) => {
    expect(args).toContain('owner')
    if (sql.includes('FROM journal_layout_state')) return [[{ structure_version: '3' }]]
    if (sql.includes('COUNT(*)')) return [[{ total: 0 }]]
    if (sql.startsWith('SELECT * FROM journal_photos') || sql.startsWith('SELECT id FROM journal_photos WHERE entry_id IN')) return [[]]
    if (sql.startsWith('SELECT DISTINCT')) return [[{ entry_id: id }]]
    if (sql.startsWith('SELECT id,url') || sql.startsWith('SELECT entry_id,url') || sql.startsWith('SELECT url')) return [[{ id, entry_id: id, url: '/journal-demo/fixture.jpg' }]]
    if (sql.startsWith('SELECT')) return [[{ id, trip_id: null, entry_date: '2026-10-30' }]]
    return [{ affectedRows: 1 }]
  })
  const connection = { execute: run, query: run, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }; state.connection = connection
  const app = express(); app.use(express.json()); app.use(createJournalRouter('unused')); app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }))
  listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve))
  const options = { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const result = await fetch(`http://127.0.0.1:${listener.address().port}${route}`, options)
  return { result, connection }
}
const routes = [
  ['/entries', 'POST', { title: 'new entry', photos: [] }],
  ['/entries/' + id, 'PUT', { title: 'edit entry', photos: [], entry_date: '2026-10-30' }],
  ['/entries/' + id, 'DELETE', {}],
  ['/photos/' + id, 'DELETE', {}],
  ['/photos', 'DELETE', { photo_ids: [id] }],
  ['/items', 'DELETE', { items: [{ kind: 'mark', id }] }],
]
it.each(routes)('%s %s rejects stale structure before mutation', async (route, method, body) => {
  const { result, connection } = await request(route, method, { ...body, expected_structure_version: '2' })
  expect(result.status).toBe(409); expect(connection.execute.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false)
  expect(connection.rollback).toHaveBeenCalledOnce()
})
it.each(routes.filter(([, method]) => method !== 'PUT'))('%s %s increments legacy structure once', async (route, method, body) => {
  const { result, connection } = await request(route, method, body)
  expect(result.status).toBe(method === 'POST' ? 201 : 200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
  expect(connection.commit).toHaveBeenCalledOnce()
})
it('keeps pure entry content edits on the same structure version', async () => {
  const { result, connection } = await request('/entries/' + id, 'PUT', { title: 'content', photos: [], entry_date: '2026-10-30', expected_structure_version: '3' })
  expect(result.status).toBe(200); expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toBe(false)
})
it.each([{ trip_id: id }, { entry_date: '2026-10-29' }])('invalidates relative layouts when entry grouping or ordering changes', async changes => {
  const { result, connection } = await request('/entries/' + id, 'PUT', { title: 'content', photos: [], entry_date: '2026-10-30', expected_structure_version: '3', ...changes })
  expect(result.status).toBe(200); expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
