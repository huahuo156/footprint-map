// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, utimes, access, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { get } from 'node:http'
vi.mock('../server/db.js', () => ({ pool: { getConnection: vi.fn(() => { throw new Error('real pool forbidden') }) } }))
vi.mock('../server/asset-lifecycle.js', () => ({ collectUnusedAssets: vi.fn(async () => ({ deleted: 2, retained: 1 })) }))
import { collectUnusedAssets } from '../server/asset-lifecycle.js'
import { runMaintenance, collectOperationsStatus, createOperationsRouter, startMaintenance } from '../server/operations.js'
import { checkOperations } from '../scripts/check-operations.js'
import { maintenanceCommand } from '../scripts/maintenance.js'

const directories = [], servers = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve)))); await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))) })
async function directory() { const d = await mkdtemp(path.join(os.tmpdir(), 'footprint-ops-')); directories.push(d); return d }
function database({ lock = 1, refs = 0 } = {}) {
  const execute = vi.fn(async (sql) => {
    if (sql.includes('GET_LOCK')) return [[{ acquired: lock }]]
    if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]]
    if (sql.includes('SELECT DISTINCT owner_id')) return [[{ owner_id: 'private-owner' }]]
    if (sql.includes('AS protected_count')) return [[{ protected_count: refs }]]
    if (sql.includes('AS near_capacity_accounts')) return [[{ near_capacity_accounts: 2 }]]
    if (sql.startsWith('SELECT COUNT')) return [[{ total: 3 }]]
    return [{ affectedRows: 3 }]
  })
  const connection = { execute, query: execute, release: vi.fn() }
  return { execute, query: execute, getConnection: vi.fn(async () => connection), connection }
}
it('cleans expired records and only old recognized unregistered files under an exclusive lock', async () => {
  const uploadDirectory = await directory(), db = database()
  const old = new Date(Date.now() - 90000000)
  const doomed = 'restore-12345678-1234-1234-1234-123456789abc.zip'
  const unknown = 'personal.png', recent = 'cover-restore-12345678-1234-1234-1234-123456789abc.png'
  for (const name of [doomed, unknown, recent]) await writeFile(path.join(uploadDirectory, name), 'x')
  for (const name of [doomed, unknown]) await utimes(path.join(uploadDirectory, name), old, old)
  const result = await runMaintenance({ database: db, uploadDirectory })
  expect(result.temporaryFiles).toBe(1)
  await expect(access(path.join(uploadDirectory, doomed))).rejects.toMatchObject({ code: 'ENOENT' })
  await access(path.join(uploadDirectory, unknown)); await access(path.join(uploadDirectory, recent))
  expect(db.execute.mock.calls.filter(([sql]) => sql.startsWith('DELETE FROM')).map(([sql]) => sql)).toHaveLength(3)
  expect(collectUnusedAssets).toHaveBeenCalledWith(uploadDirectory, expect.objectContaining({ database: db, ownerId: 'private-owner' }))
  expect(db.execute.mock.calls.at(-1)[0]).toContain('RELEASE_LOCK')
  expect(db.connection.release).toHaveBeenCalled()
})
it('dry run and registered/referenced files never delete disk files or expired database rows', async () => {
  const uploadDirectory = await directory(), db = database({ refs: 1 })
  const file = path.join(uploadDirectory, 'restore-photo-12345678-1234-1234-1234-123456789abc.png')
  await writeFile(file, 'x'); await utimes(file, new Date(0), new Date(0))
  const result = await runMaintenance({ database: db, uploadDirectory, dryRun: true })
  expect(result.temporaryFiles).toBe(0); await access(file)
  expect(db.execute.mock.calls.some(([sql]) => sql.startsWith('DELETE'))).toBe(false)
})
it('dry run counts an eligible orphan while preserving its file', async () => {
  const uploadDirectory = await directory(), db = database()
  const file = path.join(uploadDirectory, 'cover-restore-12345678-1234-1234-1234-123456789abc.webp')
  await writeFile(file, 'x'); await utimes(file, new Date(0), new Date(0))
  expect(await runMaintenance({ database: db, uploadDirectory, dryRun: true })).toMatchObject({ temporaryFiles: 1, expired: { sessions: 3 } })
  await access(file)
})
it('keeps referenced old files during a real maintenance pass', async () => {
  const uploadDirectory = await directory(), db = database({ refs: 1 })
  const file = path.join(uploadDirectory, 'restore-photo-12345678-1234-1234-1234-123456789abc.png')
  await writeFile(file, 'x'); await utimes(file, new Date(0), new Date(0))
  expect(await runMaintenance({ database: db, uploadDirectory })).toMatchObject({ temporaryFiles: 0 })
  await access(file)
})
it('releases its exclusive lock when cleanup fails', async () => {
  const db = database()
  await expect(runMaintenance({ database: db, uploadDirectory: path.join(await directory(), 'missing') })).rejects.toMatchObject({ code: 'ENOENT' })
  expect(db.execute.mock.calls.at(-1)[0]).toContain('RELEASE_LOCK')
  expect(db.connection.release).toHaveBeenCalled()
})
it('skips maintenance when another process holds its lock', async () => {
  const db = database({ lock: 0 })
  expect(await runMaintenance({ database: db, uploadDirectory: await directory() })).toMatchObject({ skipped: true })
  expect(db.execute).toHaveBeenCalledTimes(1)
  expect(db.connection.release).toHaveBeenCalled()
})
it('reports aggregate capacity and disk state without identifiers', async () => {
  const result = await collectOperationsStatus({ database: database(), uploadDirectory: await directory() })
  expect(result.nearCapacityAccounts).toBe(2)
  expect(result.disk.freeBytes).toBeGreaterThanOrEqual(0)
  expect(Array.isArray(result.warnings)).toBe(true)
  expect(JSON.stringify(result)).not.toContain('private-owner')
})
it('reports disk failures and configured low disk thresholds as fixed warning codes', async () => {
  vi.stubEnv('OPS_MIN_FREE_BYTES', String(Number.MAX_SAFE_INTEGER))
  expect((await collectOperationsStatus({ database: database(), uploadDirectory: await directory() })).warnings).toContain('disk_low')
  expect((await collectOperationsStatus({ database: database(), uploadDirectory: path.join(await directory(), 'missing') })).warnings).toContain('disk_unavailable')
  vi.unstubAllEnvs()
})
it('hides an unconfigured endpoint and requires an exact bearer token', async () => {
  // listen(0) can select a port forbidden by Fetch's browser-oriented port list.
  // This is a server HTTP test, so use HTTP directly for the random local port.
  const request = (url, options) => new Promise((resolve, reject) => {
    get(url, options, response => { response.resume(); resolve(response) }).on('error', reject)
  })
  async function serve(token) { const app = express(); app.use(createOperationsRouter({ database: database(), uploadDirectory: await directory(), token })); const s = app.listen(0, '127.0.0.1'); servers.push(s); await new Promise(r => s.once('listening', r)); return `http://127.0.0.1:${s.address().port}/status` }
  expect((await request(await serve('short'))).statusCode).toBe(404)
  const token = 'a'.repeat(32), url = await serve(token)
  expect((await request(url)).statusCode).toBe(401)
  expect((await request(url, { headers: { authorization: `Bearer ${token}x` } })).statusCode).toBe(401)
  const response = await request(url, { headers: { authorization: `Bearer ${token}` } })
  expect(response.statusCode).toBe(200)
  expect(response.headers['cache-control']).toContain('no-store')
})
it('runs scheduled failures safely and provides an idempotent stop', async () => {
  vi.useFakeTimers()
  const logger = { info: vi.fn(), error: vi.fn() }, db = database()
  db.getConnection.mockRejectedValue(new Error('private-token-must-never-log'))
  const stop = startMaintenance({ database: db, uploadDirectory: 'unused', intervalMs: 1000, logger })
  await vi.advanceTimersByTimeAsync(1000)
  expect(logger.error).toHaveBeenCalled()
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-token')
  stop(); stop(); vi.useRealTimers()
})
it('check command treats warnings, bad authentication and malformed responses as failures', async () => {
  const token = 'x'.repeat(32)
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ warnings: [] }) }))
  expect(await checkOperations({ url: 'https://example.invalid/api/operations/status', token, fetcher })).toMatchObject({ ok: true, warnings: [] })
  expect(fetcher.mock.calls[0][1].headers.authorization).toBe(`Bearer ${token}`)
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ warnings: ['disk_low'] }) })
  expect(await checkOperations({ url: 'https://example.invalid/status', token, fetcher })).toMatchObject({ ok: false, warnings: ['disk_low'] })
  fetcher.mockResolvedValue({ ok: false, status: 401 })
  await expect(checkOperations({ url: 'https://example.invalid/status', token, fetcher })).rejects.toThrow('401')
  fetcher.mockResolvedValue({ ok: true, json: async () => ({}) })
  await expect(checkOperations({ url: 'https://example.invalid/status', token, fetcher })).rejects.toThrow()
  await expect(checkOperations({ url: '', token, fetcher })).rejects.toThrow()
  await expect(checkOperations({ url: 'https://example.invalid/status', token: 'short', fetcher })).rejects.toThrow()
})
it('maintenance command forwards dry-run and always closes the database', async () => {
  const db = database(); db.end = vi.fn()
  expect(await maintenanceCommand({ database: db, uploadDirectory: await directory(), argv: ['--dry-run'] })).toMatchObject({ dryRun: true })
  expect(db.end).toHaveBeenCalled()
  db.getConnection.mockRejectedValue(new Error('unavailable'))
  await expect(maintenanceCommand({ database: db, uploadDirectory: 'unused' })).rejects.toThrow('unavailable')
  expect(db.end).toHaveBeenCalledTimes(2)
})
