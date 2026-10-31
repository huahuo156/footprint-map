import { Worker } from 'node:worker_threads'
import { pool } from './db.js'
import { incrementMetric } from './telemetry.js'

const busy = () => Object.assign(new Error('还原任务正在处理，请稍后重试。'), { status: 429 })
const active = new Set()
export async function acquireRestoreSlot(owner, { database = pool, slots = Number(process.env.RESTORE_CONCURRENCY || 2) } = {}) {
  if (!/^[\da-f-]{36}$/i.test(owner) || !Number.isInteger(slots) || slots < 1 || slots > 8) throw new Error('Invalid restore admission configuration')
  const connection = await database.getConnection(), locks = []
  const controller = new AbortController()
  const lost = () => controller.abort()
  connection.on('error', lost)
  let released = false
  async function release() {
    if (released) return
    released = true
    try {
      if (controller.signal.aborted) { connection.destroy(); return }
      for (const name of locks.reverse()) await connection.query('SELECT RELEASE_LOCK(?)', [name])
    }
    catch { connection.destroy() }
    finally { connection.off('error', lost); connection.release() }
  }
  release.signal = controller.signal
  try {
    const ownerLock = 'shitu-restore-u:' + owner
    const [[owned]] = await connection.query('SELECT GET_LOCK(?,0) AS acquired', [ownerLock])
    if (!owned?.acquired) throw busy()
    locks.push(ownerLock)
    for (let i = 0; i < slots; i++) {
      const name = 'shitu-restore-slot-' + i
      const [[slot]] = await connection.query('SELECT GET_LOCK(?,0) AS acquired', [name])
      if (slot?.acquired) { locks.push(name); return release }
    }
    throw busy()
  } catch (error) { await release(); throw error }
}

export function runRestoreThread(filename, directory, ownerId, { signal, expectedStructureVersion } = {}) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('还原锁连接中断，请重试。'), { status: 503 }))
  incrementMetric('restore_started'); incrementMetric('restore_active')
  const task = new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./restore-worker.js', import.meta.url), {
      workerData: { filename, directory, ownerId, expectedStructureVersion }, resourceLimits: { maxOldGenerationSizeMb: 512 },
    })
    const abort = () => { worker.terminate().then(() => reject(Object.assign(new Error('还原锁连接中断，请重试。'), { status: 503 }))) }
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { worker.terminate().then(() => reject(Object.assign(new Error('还原超时，请稍后重试。'), { status: 503 }))) }, 30 * 60000)
    worker.once('message', message => message.ok ? resolve(message.result) : reject(Object.assign(new Error(message.error), { status: message.status || 500, code: message.code })))
    worker.once('error', () => reject(Object.assign(new Error('还原工作线程异常，请稍后重试。'), { status: 503 })))
    worker.once('exit', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (code !== 0) reject(Object.assign(new Error('还原工作线程已中断。'), { status: 503 }))
    })
  })
  active.add(task)
  task.then(() => {
    active.delete(task); incrementMetric('restore_active', -1); incrementMetric('restore_succeeded')
  }, () => {
    active.delete(task); incrementMetric('restore_active', -1); incrementMetric('restore_failed')
  })
  return task
}
export const drainRestores = () => Promise.allSettled(active)
