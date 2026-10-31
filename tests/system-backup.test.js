import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { writeRecoveryPoint, verifyRecoveryPoint, assertOffline, assertDrillDatabase, schemaCatalog } from '../server/system-backup.js'

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'footprint-backup-test-'))
  try {
    const uploads = path.join(root, 'uploads'); await mkdir(uploads)
    await writeFile(path.join(uploads, 'actual.png'), Buffer.from([0, 1, 254, 255]))
    const catalog = await schemaCatalog()
    const database = { tables: Object.entries(catalog).map(([name, columns]) => ({ name, columns, rows: [] })) }
    database.tables.find(t => t.name === 'users').rows.push(Object.fromEntries(catalog.users.map(c => [c, ({ id: 'owner-1', email: 'private@example.com', password_hash: 'sensitive', created_at: '2026-10-27 12:34:56.123' })[c] ?? null])))
    await run({ root, uploads, database, output: path.join(root, 'recovery') })
  } finally { await rm(root, { recursive: true, force: true }) }
}
describe('full system recovery point', () => {
  it('catalogs versioned layouts and retains an explicit complete legacy profile', async () => {
    const current = await schemaCatalog(), legacy = await schemaCatalog({ legacyLayout: true })
    expect(current.journal_layout_state).toEqual(['owner_id', 'structure_version'])
    for (const name of ['journal_entries', 'journal_photos', 'journal_marks']) {
      expect(current[name]).toContain('layout_version')
      expect(legacy[name]).not.toContain('layout_version')
    }
    expect(legacy).not.toHaveProperty('journal_layout_state')
  })
  it('preserves exact version tokens in a full system recovery point', () => fixture(async ({ uploads, database, output }) => {
    database.tables.find(table => table.name === 'journal_layout_state').rows.push({ owner_id: 'owner-1', structure_version: '9007199254740993' })
    await writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })
    expect((await verifyRecoveryPoint(output)).database.tables.find(table => table.name === 'journal_layout_state').rows[0].structure_version).toBe('9007199254740993')
  }))
  it('accepts the complete old profile but rejects a partly stripped versioned schema', () => fixture(async ({ uploads, database, output }) => {
    const legacy = structuredClone(database)
    legacy.tables = legacy.tables.filter(table => table.name !== 'journal_layout_state')
    for (const table of legacy.tables) table.columns = table.columns.filter(column => column !== 'layout_version')
    await writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database: legacy })
    await verifyRecoveryPoint(output)
    const incomplete = structuredClone(database)
    const entries = incomplete.tables.find(table => table.name === 'journal_entries')
    entries.columns = entries.columns.filter(column => column !== 'layout_version')
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output + '-invalid', database: incomplete })).rejects.toThrow(/schema/i)
  }))
  it('excludes reproducible private thumbnail caches while preserving source images', () => fixture(async ({ uploads, database, output }) => {
    await mkdir(path.join(uploads, '.thumbnails', 'v1', 'actual.png'), { recursive: true })
    await writeFile(path.join(uploads, '.thumbnails', 'v1', 'actual.png', 'derived.webp'), 'reproducible derivative')
    await writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })
    const verified = await verifyRecoveryPoint(output)
    expect(verified.manifest.files.some(file => file.path.includes('.thumbnails'))).toBe(false)
    expect(await readFile(path.join(output, 'images', 'actual.png'))).toEqual(Buffer.from([0, 1, 254, 255]))
  }))
  it('rejects a recovery point that silently omits known optional columns', () => fixture(async ({ uploads, database, output }) => {
    const guides = database.tables.find(table => table.name === 'guides')
    guides.columns = guides.columns.filter(column => column !== 'content')
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })).rejects.toThrow(/column|schema/i)
  }))
  it('copies real image bytes and detects tampering and missing payloads', () => fixture(async ({ uploads, database, output }) => {
    await writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })
    const verified = await verifyRecoveryPoint(output)
    expect(verified.database.tables.find(t => t.name === 'users').rows[0].created_at).toBe('2026-10-27 12:34:56.123')
    expect(await readFile(path.join(output, 'images', 'actual.png'))).toEqual(Buffer.from([0, 1, 254, 255]))
    await writeFile(path.join(output, 'images', 'actual.png'), 'changed')
    await expect(verifyRecoveryPoint(output)).rejects.toThrow(/hash|checksum/i)
    await rm(path.join(output, 'images', 'actual.png'))
    await expect(verifyRecoveryPoint(output)).rejects.toThrow()
  }))
  it('rejects manifest path traversal before reading payloads', () => fixture(async ({ uploads, database, output }) => {
    await writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
    manifest.files[0].path = '../outside'
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest))
    await expect(verifyRecoveryPoint(output)).rejects.toThrow(/path|manifest/i)
  }))
  it('never copies .env or accepts existing output directories', () => fixture(async ({ uploads, database, output }) => {
    await writeFile(path.join(uploads, '.env'), 'SECRET=x')
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })).rejects.toThrow(/image|file/i)
    await rm(path.join(uploads, '.env'))
    await mkdir(output)
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })).rejects.toThrow()
  }))
  it('rejects backup supplied table/column SQL and non-random production drill targets', () => fixture(async ({ uploads, database, output }) => {
    database.tables[0].columns.push('id); DROP DATABASE footprint_map; --')
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })).rejects.toThrow(/column|schema/i)
    for (const name of ['footprint_map', 'footprint_restore_drill_a', 'footprint_restore_drill_123456789012;DROP']) expect(() => assertDrillDatabase(name)).toThrow()
    expect(() => assertDrillDatabase('footprint_restore_drill_0123456789abcdef01234567')).not.toThrow()
  }))
  it('requires offline declaration and refuses an online API regardless of health status', async () => {
    await expect(assertOffline({ offline: false })).rejects.toThrow(/offline/i)
    const server = createServer((req, res) => { res.writeHead(503); res.end('maintenance') })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    try { await expect(assertOffline({ offline: true, healthUrl: `http://127.0.0.1:${server.address().port}/api/health` })).rejects.toThrow(/online|running/i) }
    finally { await new Promise(resolve => server.close(resolve)) }
  })
})


// These checks catch accidental exposure of secrets and permissive archive inventories.
describe('recovery inventory boundaries', () => {
  it('rejects actual linked image paths and output paths inside the upload tree', () => fixture(async ({ uploads, database, output }) => {
    await symlink(uploads, path.join(uploads, 'linked.png'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })).rejects.toThrow(/regular files/i)
    await rm(path.join(uploads, 'linked.png'))
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: path.join(uploads, 'backup'), database })).rejects.toThrow(/outside uploads/i)
  }))
  it('rejects an unlisted regular file even if every listed hash is valid', () => fixture(async ({ uploads, database, output }) => {
    await writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })
    await writeFile(path.join(output, 'unexpected.env'), 'private')
    await expect(verifyRecoveryPoint(output)).rejects.toThrow(/unexpected/i)
  }))
  it('rejects referenced images missing from the actual file snapshot', () => fixture(async ({ uploads, database, output }) => {
    const photos = database.tables.find(table => table.name === 'journal_photos')
    photos.rows.push(Object.fromEntries(photos.columns.map(column => [column, ({ id: 'photo-a', entry_id: 'entry-a', url: '/uploads/missing.png' })[column] ?? null])))
    await expect(writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })).rejects.toThrow(/missing referenced/i)
  }))
  it('protects recovery directory access using ACLs or POSIX permission bits', () => fixture(async ({ uploads, database, output }) => {
    await writeRecoveryPoint({ uploadDirectory: uploads, outputDirectory: output, database })
    if (process.platform === 'win32') {
      const { execFile } = await import('node:child_process')
      const { promisify } = await import('node:util')
      const { stdout } = await promisify(execFile)('icacls', [output])
      expect(stdout).not.toContain('(I)')
    } else {
      const { stat } = await import('node:fs/promises')
      expect((await stat(output)).mode & 0o077).toBe(0)
      expect((await stat(path.join(output, 'database.json'))).mode & 0o077).toBe(0)
    }
  }))
})
