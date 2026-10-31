// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
const state = vi.hoisted(() => ({ connection: null }))
vi.mock('../server/db.js', () => ({ pool: { execute: (...args) => state.connection.execute(...args), getConnection: async () => state.connection } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => 'owner' }))
import { createJournalRouter } from '../server/journal.js'
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
let listener
afterEach(async () => { if (listener) { listener.closeAllConnections(); await new Promise(resolve => listener.close(resolve)); listener = null } })
async function request(method, body, { rotation = 0, version = '7', structure = '3', missing = false, fail = false } = {}) {
  const connection = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(async (sql, args) => {
    expect(args).toContain('owner')
    if (sql.includes('FROM journal_layout_state')) return [[{ structure_version: structure }]]
    if (sql.startsWith('SELECT') && sql.includes('journal_marks')) return [missing ? [] : [{ rotation, layout_version: version }]]
    if (fail && sql.startsWith('UPDATE journal_marks')) throw new Error('write failed')
    return [{ affectedRows: 1 }]
  }) }
  state.connection = connection
  const app = express(); app.use(express.json()); app.use(createJournalRouter('unused'))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ code: error.code }))
  listener = app.listen(0, '127.0.0.1'); await new Promise(resolve => listener.once('listening', resolve))
  const options = { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const result = await fetch(`http://127.0.0.1:${listener.address().port}/marks${method === 'POST' ? '' : '/' + id}`, options)
  return { result, connection, body: await result.json() }
}
const mark = { kind: 'text', text: 'hello', rotation: 2 }
it('legacy rotation edits increment row versions inside the transaction', async () => {
  const { result, connection } = await request('PUT', mark)
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.some(([sql]) => sql.includes('layout_version=layout_version+1'))).toBe(true)
  expect(connection.commit).toHaveBeenCalledOnce()
  expect(connection.execute.mock.calls.findIndex(([sql]) => sql.includes('FROM journal_layout_state'))).toBeLessThan(connection.execute.mock.calls.findIndex(([sql]) => sql.includes('FROM journal_marks')))
})
it('content-only edits preserve the row version', async () => {
  const { result, connection } = await request('PUT', { ...mark, rotation: 0, expected_structure_version: '3', expected_version: '7' })
  expect(result.status).toBe(200)
  expect(connection.execute.mock.calls.some(([sql]) => sql.includes('layout_version=layout_version+1'))).toBe(false)
})
it.each([
  { expected_structure_version: '2', expected_version: '7' },
  { expected_structure_version: '3', expected_version: '6' },
])('rejects stale updates without writing', async tokens => {
  const { result, connection } = await request('PUT', { ...mark, ...tokens })
  expect(result.status).toBe(409)
  expect(connection.execute.mock.calls.some(([sql]) => /^(UPDATE|INSERT|DELETE)/.test(sql))).toBe(false)
  expect(connection.rollback).toHaveBeenCalledOnce()
})
it.each([{ expected_structure_version: '3' }, { expected_version: '7' }])('rejects partial tokens', async tokens => {
  const { result } = await request('PUT', { ...mark, ...tokens })
  expect(result.status).toBe(400)
})
it.each(['POST', 'DELETE'])('%s increments the structure token once', async method => {
  const { result, connection } = await request(method, { ...mark, expected_structure_version: '3' })
  expect(result.status).toBe(method === 'POST' ? 201 : 200)
  expect(connection.execute.mock.calls.filter(([sql]) => sql.startsWith('UPDATE journal_layout_state'))).toHaveLength(1)
})
it('missing owned marks and failed writes roll back', async () => {
  const { result, connection } = await request('PUT', mark, { fail: true })
  expect(result.status).toBe(500)
  expect(connection.commit).not.toHaveBeenCalled()
  expect(connection.rollback).toHaveBeenCalledOnce()
})
it('deleting a foreign or missing mark does not change structure', async () => {
  const { result, connection } = await request('DELETE', {}, { missing: true })
  expect(result.status).toBe(404)
  expect(connection.execute.mock.calls.some(([sql]) => /^(UPDATE|DELETE)/.test(sql))).toBe(false)
})

