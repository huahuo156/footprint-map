import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'
import { createLayoutUser, readLayoutSnapshot } from '../server/layout-session.js'

export async function runLayoutSessionCases(db, { owner, photo, connectionOptions }) {
  const pool = mysql.createPool({ ...connectionOptions, connectionLimit: 2 })
  const created = randomUUID(), failed = randomUUID()
  try {
    assert.deepEqual(await createLayoutUser(pool, { id: created, email: 'created@example.invalid', passwordHash: 'already-hashed' }), { id: created, structure_version: '0' })
    assert.equal((await db.execute('SELECT * FROM journal_layout_state WHERE owner_id=?', [created]))[0].length, 1)
    await assert.rejects(createLayoutUser(pool, { id: randomUUID(), email: 'created@example.invalid', passwordHash: 'already-hashed' }), { code: 'ER_DUP_ENTRY' })
    // A missing token table must roll back the new user, not strand an account.
    await db.query('RENAME TABLE journal_layout_state TO journal_layout_state_fixture')
    try {
      await assert.rejects(createLayoutUser(pool, { id: failed, email: 'failed@example.invalid', passwordHash: 'already-hashed' }), { code: 'ER_NO_SUCH_TABLE' })
      assert.equal((await db.execute('SELECT * FROM users WHERE id=?', [failed]))[0].length, 0)
    } finally { await db.query('RENAME TABLE journal_layout_state_fixture TO journal_layout_state') }

    const [[initial]] = await db.execute('SELECT canvas_x,CAST(layout_version AS CHAR) AS version FROM journal_photos WHERE id=?', [photo])
    const [[token]] = await db.execute('SELECT CAST(structure_version AS CHAR) AS version FROM journal_layout_state WHERE owner_id=?', [owner])
    // Prove that a pooled connection's weaker session default cannot leak in.
    const session = await pool.getConnection()
    await session.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED')
    session.release()
    const snapshot = await readLayoutSnapshot(pool, owner, async (connection, authenticatedOwner) => {
      assert.equal(authenticatedOwner, owner)
      const [[before]] = await connection.execute('SELECT canvas_x,CAST(layout_version AS CHAR) AS version FROM journal_photos WHERE id=?', [photo])
      await db.beginTransaction()
      try {
        await db.execute('UPDATE journal_layout_state SET structure_version=structure_version+1 WHERE owner_id=?', [owner])
        await db.execute('UPDATE journal_photos SET canvas_x=canvas_x+1,layout_version=layout_version+1 WHERE id=?', [photo])
        await db.commit()
      } catch (error) { await db.rollback(); throw error }
      const [[after]] = await connection.execute('SELECT canvas_x,CAST(layout_version AS CHAR) AS version FROM journal_photos WHERE id=?', [photo])
      assert.deepEqual(before, initial)
      assert.deepEqual(after, initial)
      return { photo: after }
    })
    assert.equal(snapshot.structure_version, token.version)
    const next = await readLayoutSnapshot(pool, owner, async connection => {
      const [[value]] = await connection.execute('SELECT canvas_x,CAST(layout_version AS CHAR) AS version FROM journal_photos WHERE id=?', [photo])
      return { photo: value }
    })
    assert.equal(next.photo.canvas_x, initial.canvas_x + 1)
    assert.equal(next.photo.version, String(BigInt(initial.version) + 1n))
    assert.equal(next.structure_version, String(BigInt(token.version) + 1n))
    await assert.rejects(readLayoutSnapshot(pool, owner, connection => connection.execute('UPDATE journal_layout_state SET structure_version=structure_version+1 WHERE owner_id=?', [owner])), { code: 'ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION' })
    await db.execute('UPDATE journal_layout_state SET structure_version=9007199254740993 WHERE owner_id=?', [owner])
    assert.equal((await readLayoutSnapshot(pool, owner, async () => ({}))).structure_version, '9007199254740993')
    await db.execute('DELETE FROM journal_layout_state WHERE owner_id=?', [created])
    await assert.rejects(readLayoutSnapshot(pool, created, async () => ({})), { status: 503, code: 'LAYOUT_MIGRATION_REQUIRED' })
    assert.equal((await db.execute('SELECT * FROM journal_layout_state WHERE owner_id=?', [created]))[0].length, 0)
    console.log('Layout sessions: atomic account/token creation, creation rollback, consistent concurrent snapshot, read-only enforcement, exact bigint and missing-state rejection passed.')
  } finally { await pool.end() }
}
