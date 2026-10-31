import { expect, it, vi } from 'vitest'
import { createLayoutUser, readLayoutSnapshot } from '../server/layout-session.js'

function database() {
  const connection = { execute: vi.fn(async () => [[{ structure_version: '9007199254740993' }]]), query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() }
  return { connection, getConnection: vi.fn(async () => connection) }
}
const user = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', email: 'fixture@example.invalid', passwordHash: 'already-hashed', emailVerifiedAt: null }

it('creates the user and structure state on the same connection before commit', async () => {
  const db = database()
  await createLayoutUser(db, user)
  const calls = db.connection.execute.mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][0]).toContain('INSERT INTO users')
  expect(calls[1]).toEqual(['INSERT INTO journal_layout_state (owner_id) VALUES (?)', [user.id]])
  expect(db.connection.commit).toHaveBeenCalledOnce()
  expect(db.connection.release).toHaveBeenCalledOnce()
})

it('rolls back account creation when state initialization fails', async () => {
  const db = database()
  db.connection.execute.mockResolvedValueOnce([{}]).mockRejectedValueOnce(new Error('state unavailable'))
  await expect(createLayoutUser(db, user)).rejects.toThrow('state unavailable')
  expect(db.connection.commit).not.toHaveBeenCalled()
  expect(db.connection.rollback).toHaveBeenCalledOnce()
  expect(db.connection.release).toHaveBeenCalledOnce()
})

it('uses one explicitly repeatable read-only snapshot and returns exact structure version', async () => {
  const db = database(), reader = vi.fn(async connection => { expect(connection).toBe(db.connection); return { entries: [], structure_version: 'wrong' } })
  expect(await readLayoutSnapshot(db, user.id, reader)).toEqual({ entries: [], structure_version: '9007199254740993' })
  expect(db.connection.query.mock.calls).toEqual([['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'], ['START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY']])
  expect(db.connection.execute.mock.calls[0][1]).toEqual([user.id])
  expect(db.connection.commit).toHaveBeenCalledOnce()
  expect(db.connection.release).toHaveBeenCalledOnce()
})

it('rejects missing structure state without invoking the journal reader', async () => {
  const db = database(), reader = vi.fn()
  db.connection.execute.mockResolvedValue([[]])
  await expect(readLayoutSnapshot(db, user.id, reader)).rejects.toMatchObject({ status: 503, code: 'LAYOUT_MIGRATION_REQUIRED' })
  expect(reader).not.toHaveBeenCalled()
  expect(db.connection.rollback).toHaveBeenCalledOnce()
  expect(db.connection.release).toHaveBeenCalledOnce()
})

it('rolls back and releases a snapshot when its content reader fails', async () => {
  const db = database()
  await expect(readLayoutSnapshot(db, user.id, async () => { throw new Error('reader failed') })).rejects.toThrow('reader failed')
  expect(db.connection.commit).not.toHaveBeenCalled()
  expect(db.connection.rollback).toHaveBeenCalledOnce()
  expect(db.connection.release).toHaveBeenCalledOnce()
})
