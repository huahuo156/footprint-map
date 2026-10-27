import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
if (process.env.MIGRATION_MYSQL_USER) process.env.MYSQL_USER = process.env.MIGRATION_MYSQL_USER
if (process.env.MIGRATION_MYSQL_PASSWORD) process.env.MYSQL_PASSWORD = process.env.MIGRATION_MYSQL_PASSWORD
const { pool, initializeDatabase } = await import('../server/db.js')
const { migrateOwnership } = await import('../server/migrate-ownership.js')
try {
  await initializeDatabase()
  const schema = await readFile(new URL('../server/auth-schema.sql', import.meta.url), 'utf8')
  for (const sql of schema.split(';').filter(value => value.trim())) await pool.query(sql)
  const connection = await pool.getConnection()
  try {
    await migrateOwnership(connection, { legacyOwnerEmail: process.argv.find(value => value.startsWith('--legacy-owner='))?.slice(15), uploadDirectory: process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : fileURLToPath(new URL('../uploads/', import.meta.url)) })
  } finally { connection.release() }
  console.log('数据库迁移完成。请用运行账号启动服务。')
} catch (error) { console.error('迁移未完成：', error.message); process.exitCode = 1 }
finally { await pool.end() }
