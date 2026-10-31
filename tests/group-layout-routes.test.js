// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
const state = vi.hoisted(() => ({ connection: null }))
vi.mock('../server/db.js', () => ({ pool: { getConnection: async () => state.connection } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner' }))
import { createJournalRouter } from '../server/journal.js'
const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', g = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
let listener
afterEach(async () => { if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null } })
async function request(method, body, { versions = ['4', '5'], collapsed = 0, empty = false } = {}) {
  const run = vi.fn(async (sql, args) => {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]]
    if (!sql.startsWith('INSERT')) expect(args).toContain('owner')
    if (sql.includes('FROM journal_layout_state')) return [[{ structure_version: '3' }]]
    if (sql.startsWith('SELECT * FROM journal_canvas_groups')) return [[{ id: g, collapsed }]]
    if (sql.startsWith('SELECT photo_id,group_id')) return [empty ? [] : [{ photo_id: a, group_id: g }, { photo_id: b, group_id: g }]]
    if (sql.startsWith('SELECT child_id,parent_id')) return [[]]
    if (sql.startsWith('SELECT') && sql.includes('FROM journal_photos')) return [[{ id: a, layout_version: versions.shift(), canvas_x: 0, canvas_y: 0, rotation: 0, canvas_absolute: 1 }]]
    return [{ affectedRows: 1 }]
  })
  const connection = { execute: run, query: run, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }; state.connection = connection
  const app = express(); app.use(express.json()); app.use(createJournalRouter('unused')); app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }))
  listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve))
  const options = { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const result = await fetch(`http://127.0.0.1:${listener.address().port}/groups${method === 'POST' ? '' : '/' + g}`, options)
  return { result, connection }
}
const positions = () => [{ id: a, x: 10, y: 20, expected_version: '4' }, { id: b, x: 30, y: 40, expected_version: '5' }]
it.each(['POST', 'PATCH', 'DELETE'])('%s rejects a stale structure before writing', async method => {
  const { result, connection } = await request(method, { name: 'group', expected_structure_version: '2', ...(method === 'POST' ? { positions: positions() } : {}) })
  expect(result.status).toBe(409); expect(connection.execute.mock.calls.some(([sql]) => /^(INSERT|UPDATE|DELETE)/.test(sql))).toBe(false)
})
it('checks every photo version before creating a nested group', async () => {
  const { result, connection } = await request('POST', { name: 'group', positions: positions(), expected_structure_version: '3' }, { versions: ['4', '9'] })
  expect(result.status).toBe(409); expect(connection.execute.mock.calls.some(([sql]) => /^(INSERT|UPDATE)/.test(sql))).toBe(false)
})
it.each(['POST', 'DELETE'])('%s increments the structure once', async method => {
  const { result, connection } = await request(method, { name: 'group', positions: positions(), expected_structure_version: '3' })
  expect(result.status).toBe(method === 'POST' ? 201 : 200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it.each([[true, 1], [false, 0]])('collapsed=%s increments structure only when changed', async (collapsed, count) => {
  const { result, connection } = await request('PATCH', { collapsed, expected_structure_version: '3' })
  expect(result.status).toBe(200); expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(count)
})
it('legacy positioned edits increment photo versions', async () => {
  const { result, connection } = await request('PATCH', { collapsed: false, positions: positions().map(({ expected_version: _version, ...p }) => p) })
  expect(result.status).toBe(200); expect(connection.execute.mock.calls.filter(([sql]) => sql.includes('layout_version=layout_version+1'))).toHaveLength(2)
})
it('rejects partial group membership without writes', async () => {
  const { result, connection } = await request('PATCH', { collapsed: false, positions: positions().slice(0, 1), expected_structure_version: '3' })
  expect(result.status).toBe(400); expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
})
it('preserves empty-group edits with an empty position list', async () => {
  const { result, connection } = await request('PATCH', { collapsed: true, positions: [], expected_structure_version: '3' }, { empty: true })
  expect(result.status).toBe(200); expect(connection.commit).toHaveBeenCalledOnce()
})
