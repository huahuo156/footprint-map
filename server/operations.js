import express from 'express'
import { timingSafeEqual } from 'node:crypto'
import { readdir, lstat, statfs, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pool } from './db.js'
import { collectUnusedAssets } from './asset-lifecycle.js'
import { USER_STORAGE_BYTES } from './assets.js'
import { incrementMetric, metricsSnapshot } from './telemetry.js'

const DAY = 24 * 60 * 60 * 1000
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const temporaryName = new RegExp(`^(?:restore-${UUID}\\.zip|(?:restore-photo-|cover-restore-)${UUID}\\.(?:jpg|png|webp))$`, 'i')
const expiryTables = ['sessions', 'auth_tokens', 'rate_limits']

export async function runMaintenance({ database = pool, uploadDirectory, dryRun = false }) {
  const connection = await database.getConnection()
  let locked = false
  try {
    const [[lock]] = await connection.execute("SELECT GET_LOCK('shitu-maintenance-v1', 0) AS acquired")
    if (!Number(lock.acquired)) return { skipped: true, dryRun }
    locked = true
    const result = { skipped: false, dryRun, expired: {}, assetsDeleted: 0, assetsRetained: 0, temporaryFiles: 0 }
    for (const table of expiryTables) {
      if (dryRun) {
        const [[row]] = await connection.execute(`SELECT COUNT(*) AS total FROM ${table} WHERE expires_at<=UTC_TIMESTAMP(3)`)
        result.expired[table] = Number(row.total)
      } else {
        const [row] = await connection.execute(`DELETE FROM ${table} WHERE expires_at<=UTC_TIMESTAMP(3)`)
        result.expired[table] = Number(row.affectedRows)
      }
    }
    const [owners] = await connection.execute('SELECT DISTINCT owner_id FROM assets')
    for (const { owner_id } of owners) {
      const collected = await collectUnusedAssets(uploadDirectory, { database, ownerId: owner_id, dryRun })
      result.assetsDeleted += collected.deleted
      result.assetsRetained += collected.retained
    }
    const cutoff = Date.now() - DAY
    for (const entry of await readdir(uploadDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !temporaryName.test(entry.name)) continue
      const filename = path.join(uploadDirectory, entry.name)
      let info
      try { info = await lstat(filename) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      if (!info.isFile() || info.mtimeMs > cutoff) continue
      // Check every reference, including broken legacy references with no asset row.
      const url = '/uploads/' + entry.name
      const [[refs]] = await connection.execute(`SELECT
        (SELECT COUNT(*) FROM assets WHERE storage_key=?) +
        (SELECT COUNT(*) FROM journal_photos WHERE url=?) +
        (SELECT COUNT(*) FROM journal_notebooks WHERE cover_url=?) +
        (SELECT COUNT(*) FROM checkins WHERE image_url=?) +
        (SELECT COUNT(*) FROM guides WHERE cover_image_url=? OR LOCATE(?,content)>0) AS protected_count`, [entry.name, url, url, url, url, url])
      if (Number(refs.protected_count)) continue
      if (!dryRun) await unlink(filename).catch(error => { if (error.code !== 'ENOENT') throw error })
      result.temporaryFiles++
    }
    return result
  } finally {
    try { if (locked) await connection.execute("SELECT RELEASE_LOCK('shitu-maintenance-v1')") }
    finally { connection.release() }
  }
}

export async function collectOperationsStatus({ database = pool, uploadDirectory }) {
  const warnings = []
  let disk = null
  try {
    const fs = await statfs(uploadDirectory)
    disk = { totalBytes: Number(fs.blocks) * Number(fs.bsize), freeBytes: Number(fs.bavail) * Number(fs.bsize) }
    const configured = Number(process.env.OPS_MIN_FREE_BYTES)
    const minimum = Number.isFinite(configured) && configured >= 0 && process.env.OPS_MIN_FREE_BYTES !== undefined ? configured : 1024 ** 3
    if (disk.freeBytes < minimum) warnings.push('disk_low')
  } catch { warnings.push('disk_unavailable') }
  const [[capacity]] = await database.execute(`SELECT COUNT(*) AS near_capacity_accounts FROM
    (SELECT owner_id FROM assets GROUP BY owner_id HAVING SUM(bytes)>=?) AS near_capacity`, [Math.floor(USER_STORAGE_BYTES * 0.9)])
  const nearCapacityAccounts = Number(capacity.near_capacity_accounts)
  if (nearCapacityAccounts > 0) warnings.push('accounts_near_capacity')
  const metrics = metricsSnapshot()
  if (metrics.mail_failure > 0) warnings.push('mail_failures')
  if (metrics.http_server_errors > 0) warnings.push('http_server_errors')
  if (metrics.maintenance_failure > 0) warnings.push('maintenance_failures')
  if (metrics.restore_failed > 0) warnings.push('restore_failures')
  return { disk, nearCapacityAccounts, metrics, warnings }
}

export function createOperationsRouter({ database = pool, uploadDirectory, token = process.env.OPERATIONS_TOKEN } = {}) {
  const router = express.Router()
  router.get('/status', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (typeof token !== 'string' || token.length < 32) return res.sendStatus(404)
    const authorization = req.get('authorization') || ''
    const candidate = Buffer.from(authorization.startsWith('Bearer ') ? authorization.slice(7) : '')
    const expected = Buffer.from(token)
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) return res.sendStatus(401)
    try { res.json(await collectOperationsStatus({ database, uploadDirectory })) }
    catch { res.status(503).json({ warnings: ['status_unavailable'] }) }
  })
  return router
}

export function startMaintenance({ intervalMs = 60 * 60 * 1000, logger = console, ...options }) {
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new TypeError('Invalid maintenance interval')
  let running = false, stopped = false
  const timer = setInterval(async () => {
    if (running || stopped) return
    running = true
    try {
      const result = await runMaintenance(options)
      if (!result.skipped) incrementMetric('maintenance_success')
      logger.info(JSON.stringify({ event: 'maintenance_complete', ...result }))
    } catch {
      incrementMetric('maintenance_failure')
      logger.error(JSON.stringify({ event: 'maintenance_failed', code: 'MAINTENANCE_FAILED' }))
    } finally { running = false }
  }, intervalMs)
  timer.unref?.()
  return () => { stopped = true; clearInterval(timer) }
}
