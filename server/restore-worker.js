import { parentPort, workerData } from 'node:worker_threads'
import { pool } from './db.js'
import { withUserContext } from './auth.js'
import { restoreArchive } from './backup.js'

let message
try {
  const result = await withUserContext(workerData.ownerId, () => restoreArchive(workerData.filename, workerData.directory))
  message = { ok: true, result }
} catch (error) { message = { ok: false, status: error.status || 500, error: error.status && error.status < 500 ? error.message : '还原服务异常，请查看后端日志。' } }
finally { await pool.end() }
parentPort.postMessage(message)
