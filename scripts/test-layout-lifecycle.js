// Explicit isolated service only; never load local dotenv or the application's pool.
import mysql from 'mysql2/promise'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import assert from 'node:assert/strict'
import { assertLayoutVersions } from '../server/migrate-layout-versions.js'

if (!process.env.LAYOUT_TEST_MYSQL_PORT || !process.env.LAYOUT_TEST_MYSQL_PASSWORD) throw new Error('Set explicit LAYOUT_TEST_MYSQL_PORT and LAYOUT_TEST_MYSQL_PASSWORD for a disposable MySQL service')
const name = 'footprint_lifecycle_test_' + randomBytes(12).toString('hex')
const uploads = await mkdtemp(path.join(tmpdir(), 'footprint-lifecycle-'))
const options = { host: '127.0.0.1', port: Number(process.env.LAYOUT_TEST_MYSQL_PORT), user: process.env.LAYOUT_TEST_MYSQL_USER || 'root', password: process.env.LAYOUT_TEST_MYSQL_PASSWORD }
const db = await mysql.createConnection(options)
const run = promisify(execFile)
const env = { ...process.env, MYSQL_HOST: options.host, MYSQL_PORT: String(options.port), MYSQL_USER: options.user, MYSQL_PASSWORD: options.password, MYSQL_DATABASE: name, MIGRATION_MYSQL_USER: options.user, MIGRATION_MYSQL_PASSWORD: options.password, UPLOAD_DIRECTORY: uploads, INITIAL_USER_PASSWORD: 'Disposable-lifecycle-password-2026' }
async function cli(script, args = []) {
  await run(process.execPath, [script, ...args], { cwd: fileURLToPath(new URL('../', import.meta.url)), env, windowsHide: true, timeout: 120000 })
}
async function cleanup() {
  if (!/^footprint_lifecycle_test_[a-f0-9]{24}$/.test(name)) throw new Error('Unsafe test database name')
  const resolved = path.resolve(uploads)
  if (!resolved.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(resolved).startsWith('footprint-lifecycle-')) throw new Error('Unsafe upload directory')
  try { await db.query(`DROP DATABASE IF EXISTS ${mysql.escapeId(name)}`) }
  finally { await db.end(); await rm(resolved, { recursive: true, force: true }) }
}
try {
  await db.query(`CREATE DATABASE ${mysql.escapeId(name)} CHARACTER SET utf8mb4`)
  await db.query(`USE ${mysql.escapeId(name)}`)
  await cli('scripts/migrate-database.js')
  await assertLayoutVersions(db)
  await cli('scripts/create-user.js', ['--email=cli@example.invalid'])
  const [[user]] = await db.query("SELECT u.id,u.email_verified_at,CAST(s.structure_version AS CHAR) AS version FROM users u JOIN journal_layout_state s ON s.owner_id=u.id WHERE u.email='cli@example.invalid'")
  assert.ok(user?.email_verified_at)
  assert.equal(user.version, '0')
  await db.execute('UPDATE journal_layout_state SET structure_version=9007199254740995 WHERE owner_id=?', [user.id])
  await cli('scripts/migrate-database.js')
  await assertLayoutVersions(db)
  const [[state]] = await db.execute('SELECT CAST(structure_version AS CHAR) AS version FROM journal_layout_state WHERE owner_id=?', [user.id])
  assert.equal(state.version, '9007199254740995')
  await assert.rejects(cli('scripts/create-user.js', ['--email=cli@example.invalid']))
  assert.equal((await db.query('SELECT COUNT(*) AS count FROM users'))[0][0].count, 1)
  assert.equal((await db.query('SELECT COUNT(*) AS count FROM journal_layout_state'))[0][0].count, 1)
  console.log('Actual migration/create-user CLIs: fresh schema, account state, repeat preservation and duplicate rollback passed.')
} finally { await cleanup() }
