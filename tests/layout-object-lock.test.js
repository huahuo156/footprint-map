import { expect, it, vi } from 'vitest'
import { lockLayoutObjects } from '../server/layout-versions.js'

const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
function database(versions = ['9007199254740995', '2']) {
  return { execute: vi.fn(async sql => sql.startsWith('SELECT')
    ? [versions.length ? [{ layout_version: versions.shift(), rotation: 0 }] : []]
    : [{ affectedRows: 1 }]) }
}
it('locks in deterministic order, scopes ownership and preserves exact versions', async () => {
  const db = database()
  const locked = await lockLayoutObjects(db, 'owner', [
    { kind: 'photo', id: b, expected_version: '2' },
    { kind: 'mark', id: a, expected_version: '9007199254740995' },
  ])
  expect(db.execute.mock.calls.map(([, args]) => args)).toEqual([[a, 'owner'], [b, 'owner']])
  expect(db.execute.mock.calls.every(([sql]) => sql.includes('FOR UPDATE'))).toBe(true)
  expect(db.execute.mock.calls[1][0]).toContain('owner_entry.owner_id=?')
  expect(await locked.increment('mark', a)).toBe('9007199254740996')
  await expect(locked.increment('mark', a)).rejects.toThrow()
  expect(db.execute.mock.calls[2][0]).toContain('layout_version=layout_version+1')
})
it('checks the entire batch before allowing any update', async () => {
  const db = database(['0', '3'])
  await expect(lockLayoutObjects(db, 'owner', [
    { kind: 'mark', id: a, expected_version: '0' },
    { kind: 'photo', id: b, expected_version: '2' },
  ])).rejects.toMatchObject({ status: 409 })
  expect(db.execute.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true)
})
it('supports legacy writers and rejects missing owned objects', async () => {
  const db = database(['7'])
  const locked = await lockLayoutObjects(db, 'owner', [{ kind: 'mark', id: a }])
  expect(await locked.increment('mark', a)).toBe('8')
  await expect(lockLayoutObjects(database([]), 'owner', [{ kind: 'mark', id: a }])).rejects.toMatchObject({ status: 404 })
})
it.each([
  [{ kind: 'mark', id: a, expected_version: '01' }],
  [{ kind: 'mark', id: a }, { kind: 'photo', id: b, expected_version: '0' }],
  [{ kind: 'mark', id: a }, { kind: 'mark', id: a.toUpperCase() }],
  [{ kind: 'unknown', id: a }],
  Array(1),
])('rejects invalid batches before querying (%#)', async items => {
  const db = database()
  await expect(lockLayoutObjects(db, 'owner', items)).rejects.toMatchObject({ status: 400 })
  expect(db.execute).not.toHaveBeenCalled()
})
it('rejects overflow and attempts to increment an unlocked object', async () => {
  const db = database(['18446744073709551615'])
  const locked = await lockLayoutObjects(db, 'owner', [{ kind: 'mark', id: a }])
  await expect(locked.increment('mark', a)).rejects.toMatchObject({ status: 409 })
  await expect(locked.increment('photo', b)).rejects.toThrow()
  expect(db.execute).toHaveBeenCalledOnce()
})
