import { app } from './app.js'
import { pool } from './db.js'

try {
  const [[migration]] = await pool.query("SELECT name FROM journal_migrations WHERE name='ownership-v1'")
  if (!migration) throw new Error('请先备份并执行 npm run db:migrate，服务启动不再自动迁移数据库')
  const port = Number(process.env.API_PORT || 3001)
  const host = process.env.API_HOST || '127.0.0.1'
  const server = app.listen(port, host, () => console.log(`API ready: http://${host}:${port} (MySQL)`))
  async function shutdown() {
    server.close(async () => { await pool.end(); process.exit(0) })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
} catch (error) {
  console.error('MySQL 或数据迁移检查失败。', error.message)
  await pool.end()
  process.exitCode = 1
}
