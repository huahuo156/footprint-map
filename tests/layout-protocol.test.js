import { expect, it, vi } from 'vitest'
import { writeLayout } from '../server/layout-versions.js'
const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const item = (id = a, version = '0') => ({ id, kind: 'photo', x: 30, y: 10, rotation: 0, expected_version: version })
const payload = items => ({ expected_structure_version: '0', items })
function database(rows = new Map([[a, { canvas_x: 0, canvas_y: 0, rotation: 0, canvas_absolute: 1, layout_version: '0' }]])) {
  return { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), execute: vi.fn(async (sql, values) => {
    if (sql.includes('journal_layout_state')) return [[{ structure_version: '0' }]]
    if (sql.startsWith('SELECT')) return [rows.has(values[0]) ? [rows.get(values[0])] : []]
    return [{ affectedRows: 1 }]
  }) }
}
it('returns string versions after a conditional write', async () => {
  const db = database()
  expect(await writeLayout(db, 'owner', payload([item()]))).toEqual({ saved: 1, items: [{ id: a, kind: 'photo', layout_version: '1' }] })
  expect(db.commit).toHaveBeenCalledOnce()
  expect(db.execute.mock.calls.every(([, values]) => values.includes('owner'))).toBe(true)
})
it('does not update any row when a later member conflicts', async () => {
  const db = database(new Map([[a, { layout_version: '0' }], [b, { layout_version: '3' }]]))
  await expect(writeLayout(db, 'owner', payload([item(a), item(b)]))).rejects.toMatchObject({ status: 409, code: 'LAYOUT_CONFLICT' })
  expect(db.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
  expect(db.rollback).toHaveBeenCalledOnce()
})
it('acknowledges an exact retry without incrementing versions', async () => {
  const db = database(new Map([[a, { canvas_x: 30, canvas_y: 10, rotation: 0, canvas_absolute: 1, layout_version: '1' }]]))
  expect((await writeLayout(db, 'owner', payload([item()]))).items[0].layout_version).toBe('1')
  expect(db.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE'))).toBe(false)
})
it.each([
  { items: [item()] },
  payload([item(), { ...item(b), expected_version: undefined }]),
  payload([item(a), item(a.toUpperCase())]),
  payload([{ ...item(), expected_version: 0 }]),
  payload([{ ...item(), expected_version: '01' }]),
  payload([{ ...item(), x: NaN }]),
  payload([{ ...item(), kind: ['photo'] }]),
  payload([{ ...item(), expected_version: '18446744073709551616' }]),
])('rejects malformed requests before starting a transaction (%#)', async body => {
  const db = database()
  await expect(writeLayout(db, 'owner', body)).rejects.toMatchObject({ status: 400 })
  expect(db.beginTransaction).not.toHaveBeenCalled()
})
it('rolls back missing owned objects without identifying another owner', async () => {
  const db = database(new Map())
  await expect(writeLayout(db, 'owner', payload([item()]))).rejects.toMatchObject({ status: 404 })
  expect(db.commit).not.toHaveBeenCalled()
})

it('snapshots input before waiting for the transaction', async () => {
  const db = database(), body = payload([item()])
  let release
  db.beginTransaction.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const pending = writeLayout(db, 'owner', body)
  body.items[0].id = b; body.items[0].x = 900; body.expected_structure_version = '99'
  release()
  expect((await pending).items[0].id).toBe(a)
  expect(db.execute.mock.calls.find(([sql]) => sql.startsWith('UPDATE'))[1]).toEqual([30, 10, 0, a, 'owner'])
})
