// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
const state = vi.hoisted(() => ({ connection: null }))
vi.mock('../server/db.js', () => ({ pool: { getConnection: async () => state.connection } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner' }))
vi.mock('../server/asset-lifecycle.js', () => ({ reclaimAssets: async () => {}, collectUnusedAssets: async () => {} }))
import { createJournalRouter } from '../server/journal.js'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
let listener
afterEach(async () => { if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null } })
async function request(route, method, body, empty = false) {
  const run = vi.fn(async sql => {
    if (sql.includes('journal_layout_state') && sql.startsWith('SELECT')) return [[{ structure_version: '3' }]]
    if (sql.startsWith('SELECT * FROM journal_notebook_pages')) return [[{ id }, { id: 'b' }, { id: 'c' }]]
    if (empty && sql.startsWith('SELECT i.id')) return [[]]
    if (sql.startsWith('SELECT')) return [[{ id, notebook_id: id, page_id: id, cover_url: null }]]
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
  ['/notebooks/' + id, 'DELETE', {}], ['/notebook-pages/' + id, 'DELETE', {}],
  ['/notebook-pages/' + id + '/items', 'POST', { items: [{ kind: 'mark', id, x: 1, y: 2 }] }],
  ['/notebook-items', 'DELETE', { items: [{ kind: 'mark', id }] }],
]
it.each(routes)('%s %s rejects stale structure before mutation', async (route, method, body) => {
  const { result, connection } = await request(route, method, { ...body, expected_structure_version: '2' })
  expect(result.status).toBe(409); expect(connection.execute.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false)
})
it.each(routes.filter(([, method]) => method === 'DELETE'))('%s %s bumps once when memberships disappear', async (route, method, body) => {
  const { result, connection } = await request(route, method, body)
  expect(result.status).toBe(200); expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it.each(routes.slice(0, 2))('deleting empty %s keeps the structure version', async (route, method, body) => {
  const { result, connection } = await request(route, method, body, true)
  expect(result.status).toBe(200); expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toBe(false)
})
it('moving an existing notebook mark between pages keeps canvas membership', async () => {
  const { result, connection } = await request(routes[2][0], 'POST', { ...routes[2][2], expected_structure_version: '3' })
  expect(result.status).toBe(200); expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toBe(false)
})
