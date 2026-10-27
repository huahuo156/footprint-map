import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
if (process.env.MIGRATION_MYSQL_USER) process.env.MYSQL_USER = process.env.MIGRATION_MYSQL_USER
if (process.env.MIGRATION_MYSQL_PASSWORD) process.env.MYSQL_PASSWORD = process.env.MIGRATION_MYSQL_PASSWORD
const { pool } = await import('../server/db.js')
try {
  const email = process.argv.find(value => value.startsWith('--email='))?.slice(8).trim().toLowerCase()
  const password = process.env.INITIAL_USER_PASSWORD
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !password || password.length < 12 || password.length > 128) throw new Error('需要 --email=邮箱 与 INITIAL_USER_PASSWORD（12–128 字符）；此命令由运维确认邮箱归属')
  const schema = await readFile(new URL('../server/auth-schema.sql', import.meta.url), 'utf8')
  for (const sql of schema.split(';').filter(value => value.trim())) await pool.query(sql)
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
  await pool.execute('INSERT INTO users (id,email,password_hash,email_verified_at) VALUES (?,?,?,NOW(3))', [randomUUID(), email, hash])
  console.log('指定账号已创建；不会覆盖已有账号或自动领取历史资料。')
} catch (error) { console.error('创建失败：', error.code === 'ER_DUP_ENTRY' ? '邮箱已存在' : error.message); process.exitCode = 1 }
finally { delete process.env.INITIAL_USER_PASSWORD; await pool.end() }
