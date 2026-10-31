import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../server/db.js'
import { collectUnusedAssets } from '../server/asset-lifecycle.js'

const directory = process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : fileURLToPath(new URL('../uploads/', import.meta.url))
try {
  const [owners] = await pool.query('SELECT DISTINCT owner_id FROM assets')
  let deleted = 0, retained = 0
  const dryRun = process.argv.includes('--dry-run')
  for (const { owner_id } of owners) {
    const result = await collectUnusedAssets(directory, { ownerId: owner_id, dryRun })
    deleted += result.deleted; retained += result.retained
  }
  console.log(JSON.stringify({ dryRun, [dryRun ? 'wouldDelete' : 'deleted']: deleted, retained }))
} catch (error) { console.error('图片回收失败', { code: error.code || 'INTERNAL' }); process.exitCode = 1 }
finally { await pool.end() }
