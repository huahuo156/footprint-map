import 'dotenv/config'
import mysql from 'mysql2/promise'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { restoreDrill, writeRecoveryPoint, exportDatabase, assertDrillDatabase } from '../server/system-backup.js'

export function drillAdminOptions() {
  return { host: process.env.MYSQL_HOST || '127.0.0.1', port: Number(process.env.MYSQL_PORT || 3307),
    user: process.env.TEST_MYSQL_ADMIN_USER || 'root', password: process.env.TEST_MYSQL_ADMIN_PASSWORD || process.env.MYSQL_ROOT_PASSWORD,
    ...(process.env.MYSQL_SSL_CA ? { ssl: { ca: process.env.MYSQL_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true } } : {}),
  }
}
function assertIntegrationDirectory(resolved) {
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('footprint-restore-integration-')) throw new Error('Invalid integration cleanup boundary')
}
// Called by test:api; both the source fixture and restore target are freshly generated disposable databases.
export async function runSystemBackupIntegration({ adminOptions = drillAdminOptions() } = {}) {
  const name = 'footprint_restore_drill_' + randomBytes(12).toString('hex')
  assertDrillDatabase(name)
  const root = await mkdtemp(path.join(tmpdir(), 'footprint-restore-integration-'))
  let admin, connection, created = false
  try {
    const options = { ...adminOptions, database: undefined, multipleStatements: false, timezone: 'Z', dateStrings: true, jsonStrings: true, supportBigNumbers: true, bigNumberStrings: true }
    admin = await mysql.createConnection(options)
    await admin.query(`CREATE DATABASE ${mysql.escapeId(name)} CHARACTER SET utf8mb4`); created = true
    connection = await mysql.createConnection({ ...options, database: name })
    await connection.query("SET time_zone='+00:00'")
    // Execute the real production migrations in an isolated process: no global pool/env mutation in test:api.
    const initialize = `
      if (!/^footprint_restore_drill_[a-f0-9]{24}$/.test(process.env.MYSQL_DATABASE || '')) throw new Error('Unsafe fixture database');
      const { readFile } = await import('node:fs/promises');
      const { pool, initializeDatabase } = await import('./server/db.js');
      try {
        await initializeDatabase();
        for (const sql of (await readFile('./server/auth-schema.sql', 'utf8')).split(';').filter(value => value.trim())) await pool.query(sql);
        const { migrateOwnership } = await import('./server/migrate-ownership.js');
        const connection = await pool.getConnection();
        try { await migrateOwnership(connection, { uploadDirectory: process.env.UPLOAD_DIRECTORY }); }
        finally { connection.release(); }
      } finally { await pool.end(); }
    `
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', initialize], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
      env: { ...process.env, MYSQL_HOST: options.host, MYSQL_PORT: String(options.port), MYSQL_USER: options.user,
        MYSQL_PASSWORD: options.password || '', MYSQL_DATABASE: name, UPLOAD_DIRECTORY: path.join(root, 'images') },
    })
    for (const [id, email] of [['owner-a', 'a@example.com'], ['owner-b', 'b@example.com']]) await connection.execute('INSERT INTO users (id,email,password_hash,email_verified_at,created_at) VALUES (?,?,?,?,?)', [id, email, 'private-password-hash', '2026-10-27 01:02:03.456', '2026-10-27 01:02:03.456'])
    await connection.execute('INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)', ['a'.repeat(64), 'owner-a', 'b'.repeat(64), '2027-10-27 01:02:03.456'])
    await connection.execute('INSERT INTO rate_limits (scope,key_hash,requests,expires_at) VALUES (?,?,?,?)', ['test', 'c'.repeat(64), '9007199254740993', '2027-10-27 01:02:03.456'])
    await connection.execute('INSERT INTO landmarks (id,name,province,lat,lng) VALUES (900000,?,?,?,?)', ['legacy landmark', 'test', 30.123456789, 120.123456789])
    await connection.execute('INSERT INTO checkins (id,landmark_id,lat,lng,image_url,created_at) VALUES (1,900000,30,120,?,?)', ['/uploads/real.png', '2026-10-27 01:02:03.456'])
    await connection.execute('INSERT INTO journal_trips (id,name,owner_id) VALUES (?,?,?)', ['trip-a', 'first account', 'owner-a'])
    await connection.execute('INSERT INTO journal_trips (id,name,owner_id) VALUES (?,?,?)', ['trip-b', 'second account', 'owner-b'])
    await connection.execute('INSERT INTO journal_entries (id,trip_id,entry_date,captured_on,components,owner_id) VALUES (?,?,?,?,?,?)', ['entry-a', 'trip-a', '1999-01-02', '2026-10-27', JSON.stringify([{ text: '中文🌏', nested: { date: '2026-10-27', count: 3 }, nil: null }]), 'owner-a'])
    await connection.execute('INSERT INTO journal_photos (id,entry_id,url,components) VALUES (?,?,?,?)', ['photo-a', 'entry-a', '/uploads/real.png', JSON.stringify([{ type: 'photo', rotation: 2.125 }])])
    await connection.execute('INSERT INTO assets (storage_key,owner_id,bytes,mime) VALUES (?,?,?,?)', ['real.png', 'owner-a', 68, 'image/png'])
    await connection.execute('INSERT INTO auth_tokens (id,user_id,token_hash,purpose,expires_at) VALUES (?,?,?,?,?)', ['token-a', 'owner-a', 'd'.repeat(64), 'verify', '2027-10-27 01:02:03.456'])
    await connection.execute('INSERT INTO guides (id,title,content,cover_image_url,landmark_ids) VALUES (1,?,?,?,?)', ['legacy guide', '完整旧攻略', '/uploads/real.png', '[900000]'])
    await connection.execute("INSERT INTO likes (target_id,target_type) VALUES (1,'checkin')")
    for (const id of ['group-a', 'group-b']) await connection.execute('INSERT INTO journal_canvas_groups (id,name,collapsed,owner_id) VALUES (?,?,?,?)', [id, id, 1, 'owner-a'])
    await connection.execute('INSERT INTO journal_canvas_group_photos (photo_id,group_id) VALUES (?,?)', ['photo-a', 'group-b'])
    await connection.execute('INSERT INTO journal_canvas_group_children (child_id,parent_id) VALUES (?,?)', ['group-b', 'group-a'])
    await connection.execute('INSERT INTO journal_marks (id,kind,text,captured_on,owner_id) VALUES (?,?,?,?,?)', ['mark-a', 'text', '真实手札标注', '2026-10-27', 'owner-a'])
    await connection.execute('INSERT INTO journal_notebooks (id,name,cover_url,cover_label,cover_text,cover_mode,cover_color,bookmark_page_id,last_read_page_id,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?)', ['notebook-a', 'all account notebook', '/uploads/real.png', '旅程', '封面说明', 'photo', '#123456', 'page-a', 'page-a', 'owner-a'])
    await connection.execute('INSERT INTO journal_notebook_pages (id,notebook_id,sort_order) VALUES (?,?,?)', ['page-a', 'notebook-a', 0])
    for (const [kind, id] of [['photo', 'photo-a'], ['mark', 'mark-a'], ['entry', 'entry-a']]) await connection.execute(`INSERT INTO journal_notebook_${kind}_items (id,page_id,x,y,rotation) VALUES (?,?,?,?,?)`, [id, 'page-a', 1.25, -2.125, 3.5])
    const uploads = path.join(root, 'images'); await mkdir(uploads)
    await writeFile(path.join(uploads, 'real.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64'))
    await writeFile(path.join(uploads, 'unregistered.webp'), Buffer.from('unregistered files are preserved too'))
    const backupDirectory = path.join(root, 'backup')
    await writeRecoveryPoint({ database: await exportDatabase(connection), uploadDirectory: uploads, outputDirectory: backupDirectory })
    const result = await restoreDrill({ backupDirectory, adminOptions: options })
    assert.equal(result.cleaned, true); assert.equal(result.images, 2)
    const [remaining] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [result.database])
    assert.equal(remaining.length, 0)
    // A valid manifest can contain an impossible FK fixture: failure must also clean its disposable target.
    const databaseFile = path.join(backupDirectory, 'database.json')
    const malformed = JSON.parse(await readFile(databaseFile, 'utf8'))
    malformed.tables.find(table => table.name === 'sessions').rows[0].user_id = 'missing-user'
    const invalidDirectory = path.join(root, 'invalid-backup')
    await writeRecoveryPoint({ database: malformed, uploadDirectory: uploads, outputDirectory: invalidDirectory })
    const [before] = await admin.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'footprint_restore_drill_%'")
    await assert.rejects(restoreDrill({ backupDirectory: invalidDirectory, adminOptions: options }), /foreign key/i)
    const [after] = await admin.query("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME LIKE 'footprint_restore_drill_%'")
    assert.deepEqual(after, before)
    console.log('System recovery: two accounts, legacy+journal, date/JSON/BIGINT, actual images, checksums and failure cleanup verified.')
    return result
  } finally {
    try { if (connection) await connection.end() }
    finally {
      try { if (admin && created) { assertDrillDatabase(name); await admin.query(`DROP DATABASE ${mysql.escapeId(name)}`) } }
      finally {
        try { if (admin) await admin.end() }
        finally {
          const resolved = path.resolve(root)
          assertIntegrationDirectory(resolved)
          await rm(resolved, { recursive: true, force: true })
        }
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/restore-drill.js <backup-directory> | --integration')
  const result = process.argv[2] === '--integration' ? await runSystemBackupIntegration() : await restoreDrill({ backupDirectory: process.argv[2], adminOptions: drillAdminOptions() })
  console.log(JSON.stringify(result, null, 2))
}
