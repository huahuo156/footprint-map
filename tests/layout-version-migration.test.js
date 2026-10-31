import { expect, it, vi } from 'vitest'
import { migrateLayoutVersions, assertLayoutVersions } from '../server/migrate-layout-versions.js'

it.each([0, '0', null])('does not mutate schema when lock acquisition returns %s', async acquired => {
  const db = { query: vi.fn(async () => [[{ acquired }]]) }
  await expect(migrateLayoutVersions(db)).rejects.toThrow(/迁移/)
  expect(db.query).toHaveBeenCalledTimes(1)
})

it('rejects a conflicting existing version column and releases its lock', async () => {
  const db = { query: vi.fn(async sql => {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
    if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_TYPE: 'bigint', IS_NULLABLE: 'NO', COLUMN_DEFAULT: '0' }]]
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]]
    throw new Error('Unexpected schema mutation: ' + sql)
  }) }
  await expect(migrateLayoutVersions(db)).rejects.toThrow(/layout_version/)
  expect(db.query.mock.calls.at(-1)[0]).toContain('RELEASE_LOCK')
})

it('releases the lock when a DDL operation fails', async () => {
  const db = { query: vi.fn(async sql => {
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]]
    if (sql.includes('information_schema.COLUMNS')) return [[]]
    if (sql.startsWith('ALTER TABLE')) throw new Error('DDL unavailable')
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]]
    throw new Error('Unexpected query')
  }) }
  await expect(migrateLayoutVersions(db)).rejects.toThrow('DDL unavailable')
  expect(db.query.mock.calls.at(-1)[0]).toContain('RELEASE_LOCK')
})

it('readiness rejects a missing marker without writing', async () => {
  const db = { query: vi.fn(async () => [[]]) }
  await expect(assertLayoutVersions(db)).rejects.toThrow(/db:migrate/)
  expect(db.query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true)
})
