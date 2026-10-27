import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { pool } from './db.js'
import { currentUserId } from './auth.js'
import { assetFilename } from './assets.js'

// Mark before unlinking: a failed disk delete remains retryable and cannot be
// attached to new content. Never remove a file before the reference check commits.
export async function collectUnusedAssets(directory, { ownerId = currentUserId(), urls, olderThan = new Date(Date.now() - 86400000), dryRun = false } = {}) {
  const keys = urls && [...new Set(urls.filter(url => /^\/uploads\/[\w-]+\.(jpg|png|webp)$/.test(url)).map(assetFilename))]
  if (keys?.length === 0) return { deleted: 0, retained: 0 }
  const connection = await pool.getConnection(), removable = []
  let retained = 0
  try {
    await connection.beginTransaction()
    await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [ownerId])
    const [assets] = await connection.query(`SELECT storage_key FROM assets WHERE owner_id=? AND ${keys ? 'storage_key IN (?)' : '(created_at<=? OR status=\'staged\')'} FOR UPDATE`, [ownerId, keys || olderThan])
    for (const asset of assets) {
      const key = assetFilename('/uploads/' + asset.storage_key), url = '/uploads/' + key
      const [[refs]] = await connection.execute('SELECT (SELECT COUNT(*) FROM journal_photos WHERE url=?) + (SELECT COUNT(*) FROM journal_notebooks WHERE cover_url=?) AS total', [url, url])
      if (Number(refs.total)) { retained++; continue }
      removable.push(key)
      if (!dryRun) await connection.execute("UPDATE assets SET status='staged' WHERE storage_key=? AND owner_id=?", [key, ownerId])
    }
    await connection.commit()
  } catch (error) { await connection.rollback(); throw error }
  finally { connection.release() }
  if (!dryRun) for (const key of removable) {
    await unlink(path.join(directory, key)).catch(error => { if (error.code !== 'ENOENT') throw error })
    await pool.execute("DELETE FROM assets WHERE storage_key=? AND owner_id=? AND status='staged'", [key, ownerId])
  }
  return { deleted: removable.length, retained }
}

export async function reclaimAssets(directory, urls) {
  try { return await collectUnusedAssets(directory, { urls }) }
  catch (error) {
    // The content mutation already committed; maintenance can retry deletion.
    console.error('Asset cleanup pending', { code: error.code || 'INTERNAL' })
  }
}
