// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest'
const state = vi.hoisted(() => ({ calls: [], user: 'owner-a' }))
vi.mock('../server/db.js', () => ({ pool: { query: vi.fn(async (sql, args) => { state.calls.push([sql,args]); return [[]] }), execute: vi.fn(async () => [[]]) } }))
vi.mock('../server/auth.js', () => ({ currentUserId: () => state.user }))
import { requirePage, placeItem, readNotebooks } from '../server/notebooks.js'
beforeEach(() => { state.calls = [] })
test('private notebook reads bind the session owner on every query', async () => {
  await readNotebooks()
  expect(state.calls.length).toBe(5)
  for (const [sql, args] of state.calls) { expect(sql).toContain('owner_id'); expect(args).toContain('owner-a') }
})
test('foreign page is unavailable and page lookup requires notebook ownership', async () => {
  const connection = { execute: vi.fn(async (sql, args) => { state.calls.push([sql,args]); return [[]] }) }
  await expect(requirePage(connection, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).rejects.toMatchObject({status:404})
  expect(state.calls[0][0]).toContain('owner_id')
  expect(state.calls[0][1]).toContain('owner-a')
})
test('placement validates destination before inserting even when called directly', async () => {
  const connection = { execute: vi.fn(async () => [[]]) }
  await expect(placeItem(connection,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',{kind:'mark',id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',x:1,y:1})).rejects.toMatchObject({status:404})
  expect(connection.execute.mock.calls.every(([sql]) => !sql.includes('INSERT'))).toBe(true)
  expect(connection.execute.mock.calls[0][0]).toContain('journal_notebooks')
})
test('notebook membership reads validate source ownership as well as page ownership', async () => {
  await readNotebooks()
  const memberships = state.calls.filter(([sql]) => sql.includes('_items'))
  for (const [sql] of memberships) expect(sql).toMatch(/(?:e|s)\.owner_id=b\.owner_id/)
})
