import { app } from './app.js'
import { initializeDatabase, pool } from './db.js'

try {
  await initializeDatabase()
  const port = Number(process.env.API_PORT || 3001)
  const host = process.env.API_HOST || '127.0.0.1'
  const server = app.listen(port, host, () => console.log(`API ready: http://${host}:${port} (MySQL)`))
  async function shutdown() {
    server.close(async () => { await pool.end(); process.exit(0) })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} catch (error) {
  console.error('MySQL 初始化失败，请先运行 npm run db:up。', error.message)
  await pool.end()
  process.exitCode = 1
}
