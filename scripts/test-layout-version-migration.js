// No dotenv import or app pool: requires an explicitly selected isolated MySQL.
import mysql from 'mysql2/promise'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { migrateLayoutVersions, assertLayoutVersions } from '../server/migrate-layout-versions.js'
import { runLayoutProtocolCases } from './test-layout-protocol-cases.js'
import { runLayoutSessionCases } from './test-layout-session-cases.js'
import { runJournalReadCases } from './test-journal-read-cases.js'

if (!process.env.LAYOUT_TEST_MYSQL_PORT || !process.env.LAYOUT_TEST_MYSQL_PASSWORD) throw new Error('Set explicit LAYOUT_TEST_MYSQL_PORT and LAYOUT_TEST_MYSQL_PASSWORD for a disposable MySQL service')
const name = 'footprint_layout_test_' + randomBytes(12).toString('hex')
const db = await mysql.createConnection({ host: '127.0.0.1', port: Number(process.env.LAYOUT_TEST_MYSQL_PORT), user: process.env.LAYOUT_TEST_MYSQL_USER || 'root', password: process.env.LAYOUT_TEST_MYSQL_PASSWORD, supportBigNumbers: true, bigNumberStrings: true })
async function cleanup() {
  if (!/^footprint_layout_test_[a-f0-9]{24}$/.test(name)) throw new Error('Unsafe test database name')
  try { await db.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(name)}`) } finally { await db.end() }
}
try {
  await db.query(`CREATE DATABASE ${mysql.escapeId(name)} CHARACTER SET utf8mb4`)
  await db.query(`USE ${mysql.escapeId(name)}`)
  for (const file of ['schema.sql', 'journal-schema.sql', 'auth-schema.sql']) {
    for (const sql of (await readFile(new URL('../server/' + file, import.meta.url), 'utf8')).split(';').filter(sql => sql.trim())) await db.query(sql)
  }
  await migrateLayoutVersions(db); await assertLayoutVersions(db)
  assert.equal((await db.query('SELECT * FROM journal_layout_state'))[0].length, 0)
  // Return only this disposable empty fixture to the old schema for upgrade tests.
  await db.query('DROP TABLE journal_layout_state')
  for (const table of ['journal_entries', 'journal_photos', 'journal_marks']) await db.query(`ALTER TABLE ${table} DROP COLUMN layout_version`)
  await db.query("DELETE FROM journal_migrations WHERE name='layout-versions-v1'")
  const a = randomUUID(), b = randomUUID(), entry = randomUUID(), photo = randomUUID()
  for (const [id, email] of [[a, 'a@example.invalid'], [b, 'b@example.invalid']]) await db.execute('INSERT INTO users (id,email,password_hash) VALUES (?,?,?)', [id, email, 'not-a-login-hash'])
  await db.execute("INSERT INTO journal_entries (id,entry_date,canvas_x,canvas_y,rotation) VALUES (?,'2026-10-29',-12.5,8,7)", [entry])
  await db.execute("INSERT INTO journal_photos (id,entry_id,url,canvas_x,canvas_y) VALUES (?,?,'/fixture.png',120,240)", [photo, entry])
  await assert.rejects(assertLayoutVersions(db), /db:migrate/)
  await migrateLayoutVersions(db)
  await assertLayoutVersions(db)
  const [[position]] = await db.execute('SELECT canvas_x,canvas_y,rotation,CAST(layout_version AS CHAR) AS version FROM journal_entries WHERE id=?', [entry])
  assert.deepEqual(position, { canvas_x: -12.5, canvas_y: 8, rotation: 7, version: '0' })
  assert.equal((await db.query('SELECT * FROM journal_layout_state'))[0].length, 2)
  await db.query("UPDATE journal_entries SET layout_version=9007199254740993")
  await db.execute("UPDATE journal_layout_state SET structure_version=9007199254740995 WHERE owner_id=?", [a])
  await migrateLayoutVersions(db)
  assert.equal((await db.query('SELECT CAST(layout_version AS CHAR) AS v FROM journal_entries'))[0][0].v, '9007199254740993')
  assert.equal((await db.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [a]))[0][0].v, '9007199254740995')
  // Simulate interruption after some DDL succeeded; rerunning must finish safely.
  await db.query("DELETE FROM journal_migrations WHERE name='layout-versions-v1'")
  await db.query('ALTER TABLE journal_marks DROP COLUMN layout_version')
  await db.execute('DELETE FROM journal_layout_state WHERE owner_id=?', [b])
  await migrateLayoutVersions(db); await assertLayoutVersions(db)
  await db.query('ALTER TABLE journal_marks MODIFY layout_version BIGINT NOT NULL DEFAULT 0')
  await assert.rejects(migrateLayoutVersions(db), /layout_version/)
  const [[lock]] = await db.query("SELECT IS_FREE_LOCK('shitu-layout-versions-v1') AS available")
  assert.equal(String(lock.available), '1')
  await db.query('ALTER TABLE journal_marks MODIFY layout_version BIGINT UNSIGNED NOT NULL DEFAULT 0')
  await migrateLayoutVersions(db)
  await db.query('ALTER TABLE journal_layout_state MODIFY structure_version BIGINT NOT NULL DEFAULT 0')
  await assert.rejects(migrateLayoutVersions(db), /structure_version/)
  await assert.rejects(assertLayoutVersions(db), /structure_version/)
  await db.query('ALTER TABLE journal_layout_state MODIFY structure_version BIGINT UNSIGNED NOT NULL DEFAULT 0')
  const [[foreign]] = await db.query("SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_layout_state' AND REFERENCED_TABLE_NAME='users'")
  await db.query(`ALTER TABLE journal_layout_state DROP FOREIGN KEY ${mysql.escapeId(foreign.CONSTRAINT_NAME)}`)
  await db.query('ALTER TABLE users ADD UNIQUE INDEX idx_layout_test_user_pair (id,email)')
  await db.query('ALTER TABLE journal_layout_state ADD COLUMN owner_email VARCHAR(254) NULL, ADD CONSTRAINT fk_layout_test_pair FOREIGN KEY (owner_id,owner_email) REFERENCES users(id,email) ON DELETE CASCADE')
  await assert.rejects(migrateLayoutVersions(db), /owner foreign key/)
  await assert.rejects(assertLayoutVersions(db), /owner foreign key/)
  await db.query('ALTER TABLE journal_layout_state DROP FOREIGN KEY fk_layout_test_pair, DROP COLUMN owner_email, ADD FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE')
  await db.execute('DELETE FROM journal_layout_state WHERE owner_id=?', [b])
  await assert.rejects(assertLayoutVersions(db), /missing account state/)
  assert.equal((await db.execute('SELECT * FROM journal_layout_state WHERE owner_id=?', [b]))[0].length, 0)
  await migrateLayoutVersions(db); await assertLayoutVersions(db)
  console.log('Layout migration: empty database, upgrade, repeat, resume, bigint preservation, schema rejection, lock release and read-only readiness passed.')
  await runLayoutProtocolCases(db, { owner: a, foreignOwner: b, entry, photo, connectionOptions: { host: '127.0.0.1', port: Number(process.env.LAYOUT_TEST_MYSQL_PORT), user: process.env.LAYOUT_TEST_MYSQL_USER || 'root', password: process.env.LAYOUT_TEST_MYSQL_PASSWORD, database: name } })
  await runLayoutSessionCases(db, { owner: a, photo, connectionOptions: { host: '127.0.0.1', port: Number(process.env.LAYOUT_TEST_MYSQL_PORT), user: process.env.LAYOUT_TEST_MYSQL_USER || 'root', password: process.env.LAYOUT_TEST_MYSQL_PASSWORD, database: name } })
  await runJournalReadCases(db, { owner: a, foreignOwner: b, entry, photo, connectionOptions: { host: '127.0.0.1', port: Number(process.env.LAYOUT_TEST_MYSQL_PORT), user: process.env.LAYOUT_TEST_MYSQL_USER || 'root', password: process.env.LAYOUT_TEST_MYSQL_PASSWORD, database: name } })
} finally { await cleanup() }
