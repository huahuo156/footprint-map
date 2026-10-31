import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import { writeLayout } from '../server/layout-versions.js'

// Called only by the disposable migration test after schema preparation.
export async function runLayoutProtocolCases(db, { owner, foreignOwner, entry, photo, connectionOptions }) {
  for (const table of ['journal_entries', 'journal_marks']) await db.query(`ALTER TABLE ${table} ADD COLUMN owner_id CHAR(36)`)
  await db.execute('UPDATE journal_entries SET owner_id=? WHERE id=?', [owner, entry])
  await db.execute('UPDATE journal_layout_state SET structure_version=0 WHERE owner_id=?', [owner])
  const extra = randomUUID(), foreignEntry = randomUUID(), foreignPhoto = randomUUID(), mark = randomUUID()
  await db.execute("INSERT INTO journal_photos (id,entry_id,url,canvas_x,canvas_y) VALUES (?,?,'/fixture.png',0,0)", [extra, entry])
  await db.execute("INSERT INTO journal_entries (id,owner_id,entry_date) VALUES (?,?,'2026-10-29')", [foreignEntry, foreignOwner])
  await db.execute("INSERT INTO journal_photos (id,entry_id,url) VALUES (?,?,'/foreign.png')", [foreignPhoto, foreignEntry])
  await db.execute("INSERT INTO journal_marks (id,owner_id,kind,text,canvas_x,canvas_y,captured_on) VALUES (?,?,'text','fixture',0,0,'2026-10-29')", [mark, owner])
  const item = (id, expected_version, x = 30, kind = 'photo') => ({ id, kind, expected_version, x, y: 10, rotation: 0 })
  const request = items => ({ expected_structure_version: '0', items })
  const read = async id => (await db.execute('SELECT canvas_x,CAST(layout_version AS CHAR) AS v FROM journal_photos WHERE id=?', [id]))[0][0]
  const first = request([item(photo, '0')])
  assert.equal((await writeLayout(db, owner, first)).items[0].layout_version, '1')
  assert.equal((await writeLayout(db, owner, first)).items[0].layout_version, '1')
  assert.deepEqual(await read(photo), { canvas_x: 30, v: '1' })
  await assert.rejects(writeLayout(db, owner, request([item(extra, '0'), item(photo, '0', 90)])), { status: 409, code: 'LAYOUT_CONFLICT' })
  assert.deepEqual(await read(extra), { canvas_x: 0, v: '0' })
  await assert.rejects(writeLayout(db, owner, request([item(photo, '0'), item(extra, '0')])), { status: 409 })
  assert.deepEqual(await read(extra), { canvas_x: 0, v: '0' })
  await db.execute('UPDATE journal_photos SET canvas_absolute=FALSE WHERE id=?', [photo])
  await assert.rejects(writeLayout(db, owner, first), { status: 409 })
  await db.execute('UPDATE journal_photos SET canvas_absolute=TRUE WHERE id=?', [photo])
  await assert.rejects(writeLayout(db, owner, request([item(photo, '1', 80), item(foreignPhoto, '0')])), { status: 404, code: 'LAYOUT_ITEM_MISSING' })
  assert.deepEqual(await read(photo), { canvas_x: 30, v: '1' })
  await db.execute('UPDATE journal_layout_state SET structure_version=1 WHERE owner_id=?', [owner])
  await assert.rejects(writeLayout(db, owner, request([item(photo, '1')])), { status: 409 })
  await db.execute('UPDATE journal_layout_state SET structure_version=0 WHERE owner_id=?', [owner])
  await db.execute('UPDATE journal_photos SET layout_version=9007199254740993 WHERE id=?', [extra])
  assert.equal((await writeLayout(db, owner, request([item(extra, '9007199254740993')]))).items[0].layout_version, '9007199254740994')
  assert.equal((await writeLayout(db, owner, { items: [{ id: extra, kind: 'photo', x: 40, y: 10 }] })).items[0].layout_version, '9007199254740995')

  const other = await mysql.createConnection(connectionOptions)
  try {
    const race = await Promise.allSettled([writeLayout(db, owner, request([item(photo, '1', 31)])), writeLayout(other, owner, request([item(photo, '1', 32)]))])
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(race.find(result => result.status === 'rejected').reason.code, 'LAYOUT_CONFLICT')
    assert.equal((await read(photo)).v, '2')
    const same = request([item(photo, '2', 70)])
    const replay = await Promise.all([writeLayout(db, owner, same), writeLayout(other, owner, same)])
    assert.ok(replay.every(result => result.items[0].layout_version === '3'))
    assert.deepEqual(await read(photo), { canvas_x: 70, v: '3' })
  } finally { await other.end() }

  const mixed = request([item(entry, '9007199254740993', 50, 'entry'), item(mark, '0', 50, 'mark')])
  assert.equal((await writeLayout(db, owner, mixed)).saved, 2)
  await db.query('ALTER TABLE journal_marks ADD CONSTRAINT test_layout_failure CHECK (canvas_x <> 123456)')
  await assert.rejects(writeLayout(db, owner, request([item(entry, '9007199254740994', 88, 'entry'), item(mark, '1', 123456, 'mark')])), { code: 'ER_CHECK_CONSTRAINT_VIOLATED' })
  const [[entryAfter]] = await db.execute('SELECT canvas_x,CAST(layout_version AS CHAR) AS v FROM journal_entries WHERE id=?', [entry])
  assert.deepEqual(entryAfter, { canvas_x: 50, v: '9007199254740994' })
  await db.execute('UPDATE journal_photos SET layout_version=18446744073709551615 WHERE id=?', [extra])
  await assert.rejects(writeLayout(db, owner, { items: [{ id: extra, kind: 'photo', x: 0, y: 0 }] }), { status: 409 })
  console.log('Layout protocol: conditional writes, exact replay, atomic conflict, ownership, structure, bigint, concurrent connections and SQL failure rollback passed.')
}
