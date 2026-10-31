// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
const state = vi.hoisted(() => ({ connection: null }))
vi.mock('../server/db.js', () => ({ pool: { getConnection: async () => state.connection, execute: (...args) => state.connection.execute(...args), query: (...args) => state.connection.query(...args) } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner' }))
import { createJournalRouter } from '../server/journal.js'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
let listener
afterEach(async () => { if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null } })
async function request(method, body) {
  const run = vi.fn(async sql => {
    if (sql.includes('FROM journal_layout_state')) return [[{ structure_version: '3' }]]
    if (sql.startsWith('SELECT') && sql.includes('FROM journal_marks') && sql.includes('FOR UPDATE')) return [[{ canvas_x: 0, canvas_y: 0, rotation: 0, layout_version: '7' }]]
    return sql.startsWith('UPDATE') ? [{ affectedRows: 1 }] : [[]]
  })
  const connection = { execute: run, query: run, beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }; state.connection = connection
  const app = express(); app.use(express.json()); app.use(createJournalRouter('unused')); app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }))
  listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve))
  const options = { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
  const result = await fetch(`http://127.0.0.1:${listener.address().port}${method === 'GET' ? '/' : '/layout'}`, options)
  return { result, connection, data: await result.json() }
}
const item = { kind: 'mark', id, x: 10, y: 20, rotation: 0 }
it('reads the journal with one consistent snapshot and a string structure token', async () => {
  const { result, data, connection } = await request('GET')
  expect(result.status).toBe(200); expect(data.structure_version).toBe('3')
  expect(connection.query.mock.calls.some(([sql]) => sql.includes('WITH CONSISTENT SNAPSHOT'))).toBe(true)
  expect(connection.query.mock.calls.filter(([sql]) => sql.includes('CAST(layout_version AS CHAR)'))).toHaveLength(3)
  expect(connection.release).toHaveBeenCalledOnce()
})
it('returns exact incremented row versions for a legacy layout write', async () => {
  const { result, data, connection } = await request('PATCH', { items: [item] })
  expect(result.status).toBe(200); expect(data.items).toEqual([{ kind: 'mark', id, layout_version: '8' }]); expect(connection.release).toHaveBeenCalledOnce()
})
it('rejects a stale conditional layout without mutation and releases the connection', async () => {
  const { result, data, connection } = await request('PATCH', { expected_structure_version: '3', items: [{ ...item, expected_version: '6' }] })
  expect(result.status).toBe(409); expect(data.code).toBe('LAYOUT_CONFLICT')
  expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false); expect(connection.release).toHaveBeenCalledOnce()
})
it('rejects duplicate legacy objects before starting a transaction', async () => {
  const { result, connection } = await request('PATCH', { items: [item, item] })
  expect(result.status).toBe(400); expect(connection.beginTransaction).not.toHaveBeenCalled()
})
