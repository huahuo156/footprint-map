import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import { readJournal, readJournalSnapshot } from '../server/read-journal.js'

export async function runJournalReadCases(db, { owner, foreignOwner, entry, photo, connectionOptions }) {
  for (const table of ['journal_trips', 'journal_canvas_groups', 'journal_notebooks']) await db.query(`ALTER TABLE ${table} ADD COLUMN owner_id CHAR(36)`)
  const book = randomUUID(), page = randomUUID(), foreignBook = randomUUID(), foreignPage = randomUUID(), inner = randomUUID(), outer = randomUUID(), foreignGroup = randomUUID()
  const [[foreignPhoto]] = await db.execute('SELECT p.id FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE e.owner_id=?', [foreignOwner])
  const [[mark]] = await db.execute('SELECT id FROM journal_marks WHERE owner_id=?', [owner])
  for (const [id, own, name] of [[book, owner, 'old book'], [foreignBook, foreignOwner, 'foreign book']]) await db.execute('INSERT INTO journal_notebooks (id,owner_id,name) VALUES (?,?,?)', [id, own, name])
  for (const [id, notebook] of [[page, book], [foreignPage, foreignBook]]) await db.execute('INSERT INTO journal_notebook_pages (id,notebook_id,sort_order) VALUES (?,?,0)', [id, notebook])
  for (const id of [photo, foreignPhoto.id]) await db.execute('INSERT INTO journal_notebook_photo_items (id,page_id,x,y) VALUES (?,?,0,0)', [id, page])
  await db.execute('INSERT INTO journal_notebook_mark_items (id,page_id,x,y) VALUES (?,?,0,0)', [mark.id, foreignPage])
  for (const [id, own] of [[inner, owner], [outer, owner], [foreignGroup, foreignOwner]]) await db.execute('INSERT INTO journal_canvas_groups (id,owner_id,name) VALUES (?,?,?)', [id, own, id])
  for (const id of [inner, foreignGroup]) await db.execute('INSERT INTO journal_canvas_group_children (child_id,parent_id) VALUES (?,?)', [id, outer])
  await db.execute('INSERT INTO journal_canvas_group_photos (photo_id,group_id) VALUES (?,?)', [photo, inner])
  await db.execute('INSERT INTO journal_canvas_group_photos (photo_id,group_id) VALUES (?,?)', [foreignPhoto.id, outer])

  const pool = mysql.createPool({ ...connectionOptions, connectionLimit: 1 })
  try {
    const before = await readJournalSnapshot(pool, owner)
    assert.equal(before.entries.length, 1)
    assert.equal(before.entries[0].id, entry)
    assert.equal(typeof before.entries[0].layout_version, 'string')
    assert.equal(typeof before.entries[0].photos[0].layout_version, 'string')
    assert.ok(before.entries[0].photos.some(value => value.layout_version === '18446744073709551615'))
    assert.deepEqual(before.notebook_items.map(item => item.id), [photo])
    assert.deepEqual(before.canvas_groups.find(group => group.id === outer).photo_ids, [photo])
    assert.deepEqual(before.canvas_groups.find(group => group.id === outer).child_group_ids, [inner])
    const other = await readJournalSnapshot(pool, foreignOwner)
    assert.equal(other.notebooks[0].id, foreignBook)
    assert.equal(other.notebook_items.length, 0, 'foreign source in own page must stay filtered')
    assert.ok(other.entries.every(value => value.id !== entry))

    let updated = false
    const interleaved = { getConnection: async () => {
      const connection = await pool.getConnection()
      return {
        execute: connection.execute.bind(connection), commit: connection.commit.bind(connection), rollback: connection.rollback.bind(connection), release: connection.release.bind(connection),
        query: async (sql, args) => {
          const result = await connection.query(sql, args)
          if (!updated && sql.includes('FROM journal_entries WHERE')) {
            updated = true
            await db.beginTransaction()
            try {
              await db.execute('UPDATE journal_layout_state SET structure_version=structure_version+1 WHERE owner_id=?', [owner])
              await db.execute('UPDATE journal_entries SET canvas_x=canvas_x+1,layout_version=layout_version+1 WHERE id=?', [entry])
              await db.execute('UPDATE journal_photos SET canvas_x=canvas_x+1,layout_version=layout_version+1 WHERE id=?', [photo])
              await db.execute("UPDATE journal_notebooks SET name='new book' WHERE id=?", [book])
              await db.commit()
            } catch (error) { await db.rollback(); throw error }
          }
          return result
        },
      }
    } }
    const during = await readJournalSnapshot(interleaved, owner)
    assert.equal(updated, true)
    assert.deepEqual(during, before, 'all twelve reads must remain in the old snapshot')
    const after = await readJournalSnapshot(pool, owner)
    assert.equal(after.structure_version, String(BigInt(before.structure_version) + 1n))
    assert.equal(after.entries[0].canvas_x, before.entries[0].canvas_x + 1)
    assert.equal(after.entries[0].layout_version, String(BigInt(before.entries[0].layout_version) + 1n))
    assert.equal(after.entries[0].photos.find(value => value.id === photo).canvas_x, before.entries[0].photos.find(value => value.id === photo).canvas_x + 1)
    assert.equal(after.notebooks[0].name, 'new book')
    const legacy = await readJournal(db, owner)
    assert.equal(Object.hasOwn(legacy, 'structure_version'), false)
    assert.deepEqual(Object.keys(legacy).sort(), Object.keys(after).filter(key => key !== 'structure_version').sort())
    console.log('Journal reader: full same-connection snapshot, exact versions, nested groups/notebooks, cross-owner references and legacy shape passed.')
  } finally { await pool.end() }
}
