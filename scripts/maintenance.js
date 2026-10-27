import 'dotenv/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../server/db.js'
import { runMaintenance } from '../server/operations.js'

export async function maintenanceCommand({ database = pool, uploadDirectory = process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : fileURLToPath(new URL('../uploads/', import.meta.url)), argv = process.argv.slice(2) } = {}) {
  try { return await runMaintenance({ database, uploadDirectory, dryRun: argv.includes('--dry-run') }) }
  finally { await database.end() }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await maintenanceCommand())) }
  catch { console.error(JSON.stringify({ event: 'maintenance_failed', code: 'MAINTENANCE_FAILED' })); process.exitCode = 1 }
}
