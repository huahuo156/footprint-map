import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { pool } from '../server/db.js'

if (!/^footprint_security_test_[a-f0-9]{12}$/.test(process.env.MYSQL_DATABASE || '') || process.env.MYSQL_DATABASE !== process.env.SECURITY_TEST_DATABASE) throw new Error('Disposable database required')
const server = createServer()
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const baseURL = `http://127.0.0.1:${server.address().port}`
  process.env.APP_ORIGIN = baseURL
  const { app } = await import('../server/app.js')
  server.on('request', app)
  const hash = await argon2.hash('disposable-browser-password-123', { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
  const { createLayoutUser } = await import('../server/layout-session.js')
  for (const project of ['desktop', 'mobile']) for (const name of ['a', 'b']) await createLayoutUser(pool, { id: randomUUID(), email: `${project}-${name}@example.com`, passwordHash: hash, emailVerifiedAt: new Date() })
  const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.config.js'], { stdio: 'inherit', env: { ...process.env, E2E_BASE_URL: baseURL } })
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await pool.end()
}
