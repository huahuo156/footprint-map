import mysql from 'mysql2/promise'
import { randomBytes, createHash } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir, lstat, mkdtemp, rm, realpath } from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'

const OWNER_TABLES = ['journal_trips', 'journal_entries', 'journal_marks', 'journal_canvas_groups', 'journal_notebooks']
const SCHEMA_FILES = ['schema.sql', 'journal-schema.sql', 'auth-schema.sql']
const IMAGE = /^[\w-]+\.(?:jpg|png|webp)$/
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const fail = message => { throw new Error(message) }
const quote = name => mysql.escapeId(name)

// The only SQL ever executed during restore comes from these trusted project files.
async function schemaStatements() {
  const statements = []
  for (const file of SCHEMA_FILES) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8')
    statements.push(...text.split(';').filter(value => value.trim()))
  }
  return statements
}
export async function schemaCatalog() {
  const catalog = {}
  for (const sql of await schemaStatements()) {
    const match = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*)\)\s*$/i.exec(sql)
    if (!match) fail('Unsupported local schema')
    const columns = [...match[2].matchAll(/(?:^|,)\s*(\w+)\s+(?:INT|VARCHAR|CHAR|DOUBLE|TEXT|MEDIUMTEXT|DATE|DATETIME|TIMESTAMP|JSON|ENUM|BOOLEAN|BIGINT)\b/gi)].map(item => item[1])
    catalog[match[1]] = columns
  }
  for (const name of OWNER_TABLES) catalog[name].push('owner_id')
  return catalog
}
async function validateDatabase(database) {
  const catalog = await schemaCatalog()
  if (!database || !Array.isArray(database.tables) || database.tables.length !== Object.keys(catalog).length) fail('Incomplete database schema')
  const seen = new Set()
  for (const table of database.tables) {
    if (!table || !Object.hasOwn(catalog, table.name) || seen.has(table.name)) fail('Invalid table schema')
    seen.add(table.name)
    if (!Array.isArray(table.columns) || table.columns.length !== catalog[table.name].length || new Set(table.columns).size !== table.columns.length || table.columns.some(c => !catalog[table.name].includes(c))) fail('Invalid or incomplete column schema')
    if (!Array.isArray(table.rows)) fail('Invalid table rows')
    for (const row of table.rows) {
      if (!row || Array.isArray(row) || typeof row !== 'object' || Object.keys(row).length !== table.columns.length || table.columns.some(c => !Object.hasOwn(row, c))) fail('Invalid row columns')
      for (const value of Object.values(row)) if (value !== null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) fail('Invalid row scalar')
    }
  }
  return catalog
}
async function regularFile(file) {
  const info = await lstat(file)
  if (info.isSymbolicLink() || !info.isFile()) fail('Only regular files are allowed')
  return info
}
async function directory(dir) {
  const info = await lstat(dir)
  if (info.isSymbolicLink() || !info.isDirectory()) fail('Only real directories are allowed')
  return realpath(dir)
}
async function imageNames(dir) {
  await directory(dir)
  const names = (await readdir(dir)).sort()
  for (const name of names) {
    if (!IMAGE.test(name)) fail('Unexpected image file in upload directory')
    await regularFile(path.join(dir, name))
  }
  return names
}
export async function assertOffline({ offline, healthUrl = process.env.API_HEALTH_URL || `http://127.0.0.1:${process.env.API_PORT || 3001}/api/health` } = {}) {
  if (offline !== true) fail('Explicit --offline is required: stop API and every worker before backup')
  const url = new URL(healthUrl)
  if (!['http:', 'https:'].includes(url.protocol)) fail('Invalid API health URL')
  try {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
  } catch (error) {
    // DNS, TLS, timeout and routing failures cannot prove a stopped API.
    if (error.cause?.code === 'ECONNREFUSED') return
    fail('Cannot confirm API offline; health probe failed without connection refusal')
  }
  fail('API is online/running; stop it before creating a backup')
}
async function protectDirectory(target) {
  if (process.platform !== 'win32') return
  const execute = promisify(execFile)
  const { stdout } = await execute('whoami', ['/user', '/fo', 'csv', '/nh'], { windowsHide: true })
  const sid = /S-1-(?:[0-9]+-)+[0-9]+/.exec(stdout)?.[0]
  if (!sid) fail('Cannot identify backup directory owner SID')
  await execute('icacls', [target, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'], { windowsHide: true })
}
export async function writeRecoveryPoint({ database, uploadDirectory, outputDirectory }) {
  await validateDatabase(database)
  const uploads = await directory(uploadDirectory)
  const target = path.resolve(outputDirectory)
  const parent = await realpath(path.dirname(target))
  const canonicalTarget = path.join(parent, path.basename(target))
  if (canonicalTarget === uploads || canonicalTarget.startsWith(uploads + path.sep)) fail('Backup output must be outside uploads')
  const names = await imageNames(uploads)
  // Exclusive creation; caller owns failures for inspection, never delete user supplied paths.
  await mkdir(target, { mode: 0o700 })
  await protectDirectory(target)
  await mkdir(path.join(target, 'images'), { mode: 0o700 })
  const files = []
  async function save(relative, bytes) {
    await writeFile(path.join(target, relative), bytes, { flag: 'wx', mode: 0o600 })
    files.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) })
  }
  await save('database.json', Buffer.from(JSON.stringify(database)))
  for (const name of names) await save(`images/${name}`, await readFile(path.join(uploads, name)))
  const manifest = { format: 'footprint-system-backup', version: 1, createdAt: new Date().toISOString(), consistency: 'offline-api-and-all-workers-stopped', files }
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2))
  await writeFile(path.join(target, 'manifest.json'), bytes, { flag: 'wx', mode: 0o600 })
  await writeFile(path.join(target, 'manifest.sha256'), sha256(bytes) + '\n', { flag: 'wx', mode: 0o600 })
  await verifyRecoveryPoint(target)
  return { directory: target, tables: database.tables.length, images: names.length, manifestSha256: sha256(bytes) }
}
export async function verifyRecoveryPoint(backupDirectory) {
  const root = await directory(backupDirectory)
  for (const name of ['manifest.json', 'manifest.sha256']) await regularFile(path.join(root, name))
  const bytes = await readFile(path.join(root, 'manifest.json'))
  const manifest = JSON.parse(bytes)
  // Validate names before touching payloads, even if a malicious actor also edits the checksum.
  if (manifest.format !== 'footprint-system-backup' || manifest.version !== 1 || !Array.isArray(manifest.files)) fail('Invalid manifest')
  const listed = new Set()
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !(file.path === 'database.json' || /^images\/[\w-]+\.(jpg|png|webp)$/.test(file.path)) || listed.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) fail('Invalid manifest path or checksum')
    listed.add(file.path)
  }
  if (!listed.has('database.json')) fail('Missing database manifest entry')
  if ((await readFile(path.join(root, 'manifest.sha256'), 'utf8')).trim() !== sha256(bytes)) fail('Manifest checksum mismatch')
  const top = (await readdir(root)).sort()
  if (JSON.stringify(top) !== JSON.stringify(['database.json', 'images', 'manifest.json', 'manifest.sha256'])) fail('Unexpected backup files')
  const names = await imageNames(path.join(root, 'images'))
  if (names.length + 1 !== listed.size || names.some(name => !listed.has(`images/${name}`))) fail('Image manifest mismatch')
  for (const file of manifest.files) {
    await regularFile(path.join(root, file.path))
    const payload = await readFile(path.join(root, file.path))
    if (payload.length !== file.bytes || sha256(payload) !== file.sha256) fail(`Payload hash/checksum mismatch: ${file.path}`)
  }
  const database = JSON.parse(await readFile(path.join(root, 'database.json'), 'utf8'))
  await validateDatabase(database)
  // Referenced local images must actually be present, including legacy tables.
  for (const table of database.tables) for (const row of table.rows) for (const [column, value] of Object.entries(row)) {
    if (table.name === 'assets' && column === 'storage_key' && !listed.has(`images/${value}`)) fail('Missing registered image')
    if (['url', 'image_url', 'cover_image_url', 'cover_url'].includes(column) && typeof value === 'string' && value.startsWith('/uploads/')) {
      const name = value.slice('/uploads/'.length)
      if (!IMAGE.test(name) || !listed.has(`images/${name}`)) fail('Missing referenced image or invalid image path')
    }
  }
  return { manifest, database, directory: root }
}
export async function exportDatabase(connection) {
  const catalog = await schemaCatalog()
  const [tables] = await connection.query('SHOW FULL TABLES')
  const names = tables.map(row => Object.values(row)[0])
  if (names.length !== Object.keys(catalog).length || names.some(name => !Object.hasOwn(catalog, name))) fail('Unknown or missing source table; update recovery schema before backup')
  const result = { tables: [] }
  await connection.query("SET time_zone='+00:00'")
  for (const name of Object.keys(catalog)) {
    const [fields] = await connection.query('SELECT COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [name])
    if (fields.some(field => !catalog[name].includes(field.COLUMN_NAME))) fail('Unknown source column; update recovery schema before backup')
    const columns = fields.map(field => field.COLUMN_NAME)
    const select = fields.map(field => {
      const id = quote(field.COLUMN_NAME)
      return ['json', 'date', 'datetime', 'timestamp', 'bigint', 'decimal'].includes(field.DATA_TYPE) ? `CAST(${id} AS CHAR) AS ${id}` : id
    }).join(',')
    const [rows] = await connection.query(`SELECT ${select} FROM ${quote(name)}`)
    result.tables.push({ name, columns, rows })
  }
  await validateDatabase(result)
  return result
}
export async function createSystemBackup({ connection, offline, healthUrl, uploadDirectory, outputDirectory }) {
  await assertOffline({ offline, healthUrl })
  const database = await exportDatabase(connection)
  await assertOffline({ offline, healthUrl })
  const result = await writeRecoveryPoint({ database, uploadDirectory, outputDirectory })
  await assertOffline({ offline, healthUrl })
  return result
}
export function assertDrillDatabase(name) {
  if (!/^footprint_restore_drill_[a-f0-9]{24}$/.test(name)) fail('Invalid disposable restore drill database')
}
export async function initializeDrillSchema(connection) {
  const [[{ name }]] = await connection.query('SELECT DATABASE() AS name')
  assertDrillDatabase(name)
  // users must exist before ownership foreign keys; raw schema does not seed or migrate data.
  const statements = await schemaStatements()
  const users = statements.find(sql => /CREATE TABLE IF NOT EXISTS users\s/.test(sql))
  await connection.query(users)
  for (const sql of statements) if (sql !== users) await connection.query(sql)
  for (const table of OWNER_TABLES) await connection.query(`ALTER TABLE ${quote(table)} ADD COLUMN owner_id CHAR(36) NULL, ADD FOREIGN KEY (owner_id) REFERENCES users(id)`)
}
function assertTempImages(directoryName) {
  const resolved = path.resolve(directoryName)
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !/^footprint-restore-drill-[\w-]+$/.test(path.basename(resolved))) fail('Invalid disposable image cleanup path')
}
export async function restoreDrill({ backupDirectory, adminOptions }) {
  // Verify everything before opening admin connection or creating any resources.
  const verified = await verifyRecoveryPoint(backupDirectory)
  const name = 'footprint_restore_drill_' + randomBytes(12).toString('hex')
  assertDrillDatabase(name)
  const imageDirectory = await mkdtemp(path.join(tmpdir(), 'footprint-restore-drill-'))
  assertTempImages(imageDirectory)
  let admin, connection, created = false
  try {
    // Ignore database supplied in configuration. A drill target cannot be chosen by caller.
    const options = { ...adminOptions, database: undefined, multipleStatements: false, dateStrings: true, jsonStrings: true, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z' }
    admin = await mysql.createConnection(options)
    await admin.query(`CREATE DATABASE ${quote(name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
    created = true
    connection = await mysql.createConnection({ ...options, database: name })
    await connection.query("SET time_zone='+00:00'")
    await initializeDrillSchema(connection)
    const catalog = await schemaCatalog()
    // Schema creation order already follows dependencies except users, which goes first.
    const order = ['users', ...Object.keys(catalog).filter(table => table !== 'users')]
    const tables = new Map(verified.database.tables.map(table => [table.name, table]))
    await connection.beginTransaction()
    for (const tableName of order) {
      const table = tables.get(tableName)
      for (const row of table.rows) await connection.execute(`INSERT INTO ${quote(tableName)} (${table.columns.map(quote).join(',')}) VALUES (${table.columns.map(() => '?').join(',')})`, table.columns.map(column => row[column]))
    }
    await connection.commit()
    for (const table of verified.database.tables) {
      const [[row]] = await connection.query(`SELECT COUNT(*) AS total FROM ${quote(table.name)}`)
      if (Number(row.total) !== table.rows.length) fail(`Restored row count mismatch: ${table.name}`)
    }
    // Re-export checks date, JSON, BIGINT and every other scalar, beyond row counts.
    const actual = await exportDatabase(connection)
    for (const expected of verified.database.tables) {
      const restored = actual.tables.find(table => table.name === expected.name)
      const canonical = rows => rows.map(row => JSON.stringify(expected.columns.map(column => row[column]))).sort()
      if (JSON.stringify(canonical(restored.rows)) !== JSON.stringify(canonical(expected.rows))) fail(`Restored row data mismatch: ${expected.name}`)
    }
    for (const file of verified.manifest.files.filter(file => file.path.startsWith('images/'))) {
      const destination = path.join(imageDirectory, path.basename(file.path))
      await writeFile(destination, await readFile(path.join(verified.directory, file.path)), { flag: 'wx', mode: 0o600 })
      if (sha256(await readFile(destination)) !== file.sha256) fail('Restored image hash mismatch')
    }
    return { database: name, tables: tables.size, rows: verified.database.tables.reduce((sum, table) => sum + table.rows.length, 0), images: verified.manifest.files.length - 1, cleaned: true }
  } finally {
    try { if (connection) await connection.end() }
    finally {
      try {
        if (admin && created) { assertDrillDatabase(name); await admin.query(`DROP DATABASE ${quote(name)}`) }
      } finally {
        try { if (admin) await admin.end() }
        finally { assertTempImages(imageDirectory); await rm(imageDirectory, { recursive: true, force: true }) }
      }
    }
  }
}
