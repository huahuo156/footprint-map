import { expect, it, vi } from 'vitest'
import { lockLayoutStructure } from '../server/layout-versions.js'

function db(value = '0') {
  return { execute: vi.fn(async sql => sql.startsWith('SELECT') ? [value === null ? [] : [{ structure_version: value }]] : [{ affectedRows: 1 }]) }
}
it('locks the authenticated owner, checks the expected token and increments exactly once', async () => {
  const connection = db('9007199254740995')
  const state = await lockLayoutStructure(connection, 'owner', '9007199254740995')
  expect(state.version).toBe('9007199254740995')
  expect(await state.increment()).toBe('9007199254740996')
  await expect(state.increment()).rejects.toThrow()
  expect(connection.execute.mock.calls[0][0]).toMatch(/FOR UPDATE/)
  expect(connection.execute.mock.calls.map(call => call[1])).toEqual([['owner'], ['owner']])
})
it('rejects stale, invalid, missing and exhausted states before updating', async () => {
  for (const [value, expected, status] of [['3', '2', 409], ['3', '01', 400], [null, undefined, 503], ['18446744073709551615', undefined, 409]]) {
    const connection = db(value)
    await expect((async () => { const state = await lockLayoutStructure(connection, 'owner', expected); await state.increment() })()).rejects.toMatchObject({ status })
    expect(connection.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
  }
})
