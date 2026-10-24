// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import express from 'express'

// The external database is unavailable in the unit environment. Keep HTTP routing,
// validation and SQL generation real while recording the database boundary.
const db = vi.hoisted(() => ({ execute: vi.fn(), query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }))
vi.mock('../server/db.js', () => ({ pool: { query: db.query, getConnection: async () => db } }))
import { notebookRoutes, readNotebooks } from '../server/notebooks.js'
let server, base
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  notebookRoutes(app)
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
beforeEach(() => {
  vi.clearAllMocks()
  db.execute.mockImplementation(async sql => sql.startsWith('SELECT id FROM') ? [[{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]] : [[]])
  db.query.mockImplementation(async sql => sql.includes('GET_LOCK') ? [[{ acquired: 1 }]] : [[]])
})
afterAll(async () => { await new Promise(resolve => server.close(resolve)) })
async function request(body, method = 'POST') {
  const options = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) options.body = JSON.stringify(body)
  const response = await fetch(base + '/notebooks' + (method === 'PATCH' ? '/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' : ''), options)
  return { status: response.status, data: await response.json() }
}

it('creates default MEMO metadata and includes both cover fields in the insert', async () => {
  const result = await request({ name: 'Book' })
  expect(result.status).toBe(201)
  expect(result.data).toMatchObject({ cover_label: 'MEMO', cover_text: '' })
  const [sql, values] = db.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO journal_notebooks'))
  expect(sql).toContain('cover_label,cover_text')
  expect(values).toContain('MEMO')
})

it('patches arbitrary trimmed cover wording and permits intentionally empty labels', async () => {
  const result = await request({ cover_label: '  My Notebook  ', cover_text: '  风与记忆\n留在这里  ' }, 'PATCH')
  expect(result.status).toBe(200)
  expect(result.data).toMatchObject({ cover_label: 'My Notebook', cover_text: '风与记忆\n留在这里' })
  expect(db.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE journal_notebooks'))).toEqual(['UPDATE journal_notebooks SET cover_label=?,cover_text=? WHERE id=?', ['My Notebook', '风与记忆\n留在这里', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']])
  expect((await request({ cover_label: '' }, 'PATCH')).data.cover_label).toBe('')
})

it.each([{ cover_label: 3 }, { cover_label: null }, { cover_label: 'a'.repeat(61) }, { cover_text: [] }, { cover_text: null }, { cover_text: 'a'.repeat(501) }])('rejects invalid cover metadata %j', async fields => {
  expect((await request({ name: 'Book', ...fields })).status).toBe(400)
  expect((await request(fields, 'PATCH')).status).toBe(400)
  expect(db.execute).not.toHaveBeenCalled()
})

it('reads cover fields and falls back for old rows while preserving explicit blank labels', async () => {
  db.query.mockResolvedValueOnce([[{ id: 'old' }, { id: 'hidden', cover_label: '', cover_text: 'A note' }]])
  const result = await readNotebooks()
  expect(db.query.mock.calls[0][0]).toContain('cover_label,cover_text')
  expect(result.notebooks).toEqual([{ id: 'old', cover_label: 'MEMO', cover_text: '', cover_mode: 'solid', cover_color: '#e3e9dd' }, { id: 'hidden', cover_label: '', cover_text: 'A note', cover_mode: 'solid', cover_color: '#e3e9dd' }])
})

it.each([{ cover_mode: 'bad' }, { cover_mode: null }, { cover_color: 'red' }, { cover_color: '#fff' }, { cover_color: '#12zz56' }, { cover_color: null }])('rejects invalid cover style at create and patch %j', async fields => {
  expect((await request({ name: 'Book', ...fields })).status).toBe(400)
  expect((await request(fields, 'PATCH')).status).toBe(400)
})
it('persists selected cover style and defaults legacy photo covers', async () => {
  expect((await request({ name: 'Solid' })).data).toMatchObject({ cover_mode: 'solid', cover_color: '#e3e9dd' })
  expect((await request({ name: 'Photo', cover_url: '/notebook-covers/lake.jpg' })).data).toMatchObject({ cover_mode: 'photo', cover_url: '/notebook-covers/lake.jpg' })
  expect((await request({ cover_mode: 'text', cover_color: '#AABBCC', cover_label: '' }, 'PATCH')).data).toMatchObject({ cover_mode: 'text', cover_color: '#AABBCC', cover_label: '' })
})
