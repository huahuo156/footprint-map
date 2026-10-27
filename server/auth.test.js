import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import argon2 from 'argon2'
import { createHash } from 'node:crypto'
import { createAuthRouter, createAuthMiddleware, currentUserId, rateLimit } from './auth.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const user = { id: 'user-a', email: 'a@example.com', password_hash: '', email_verified_at: null }
async function serve(database, options = {}) {
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter({ database, ...options }))
  const middleware = createAuthMiddleware({ database, appOrigin: 'https://example.com' })
  app.use(middleware.requireAuth, middleware.csrfProtection)
  app.get('/private', (req, res) => res.json({ id: currentUserId() }))
  app.post('/private', middleware.requireVerified, (req, res) => res.json({ id: currentUserId() }))
  app.use((error, req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  return { request: (path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init), close: () => new Promise(resolve => server.close(resolve)) }
}
const body = value => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

test('anonymous sessions disclose no identity and protected routes reject access', async () => {
  const api = await serve({ execute() { throw new Error('unexpected query') } })
  try {
    assert.deepEqual(await (await api.request('/api/auth/session')).json(), { user: null, csrfToken: null })
    assert.equal((await api.request('/private')).status, 401)
    assert.throws(() => currentUserId(), error => error.status === 401)
  } finally { await api.close() }
})

test('session tokens are hashed, scoped to async request, and unsafe writes require origin and CSRF', async () => {
  const token = 'a'.repeat(64), csrf = 'b'.repeat(64)
  const database = { async execute(sql, args) {
    assert.match(sql, /sessions/)
    assert.equal(args[0], hash(token))
    return [[{ ...user, csrf_token: csrf, expires_at: new Date(Date.now() + 60000) }]]
  } }
  const api = await serve(database)
  const headers = { Cookie: `shitu_session=${token}` }
  try {
    const session = await (await api.request('/api/auth/session', { headers })).json()
    assert.deepEqual(session, { user: { id: 'user-a', email: 'a@example.com', email_verified: false }, csrfToken: csrf })
    assert.deepEqual(await (await api.request('/private', { headers })).json(), { id: 'user-a' })
    assert.equal((await api.request('/private', { method: 'POST', headers })).status, 403)
    assert.equal((await api.request('/private', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example', 'X-CSRF-Token': csrf } })).status, 403)
    const verified = await api.request('/private', { method: 'POST', headers: { ...headers, Origin: 'https://example.com', 'X-CSRF-Token': csrf } })
    assert.equal(verified.status, 403)
    assert.match((await verified.json()).error, /验证/)
  } finally { await api.close() }
})

test('registration stays closed without explicit enablement and working mail configuration', async () => {
  const api = await serve({ execute() { throw new Error('unexpected query') } }, { config: { registrationEnabled: true } })
  try { assert.equal((await api.request('/api/auth/register', body({ email: 'a@example.com', password: 'correct horse battery staple' }))).status, 503) }
  finally { await api.close() }
})

test('rate limiting returns retry-after and bounds repeated requests', async () => {
  const app = express()
  app.get('/', rateLimit({ windowMs: 60000, max: 1 }), (req, res) => res.sendStatus(204))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}`
    assert.equal((await fetch(url)).status, 204)
    const denied = await fetch(url)
    assert.equal(denied.status, 429)
    assert.ok(Number(denied.headers.get('Retry-After')) > 0)
  } finally { await new Promise(resolve => server.close(resolve)) }
})

// SQL adapter keeps the real router, Argon2, session cookies and token flow while
// replacing only external MySQL. Unrecognized statements deliberately fail.
function memoryDatabase() {
  const state = { users: [], sessions: [], tokens: [] }
  const execute = async (sql, values = []) => {
    if (sql.startsWith('INSERT INTO users')) {
      if (state.users.some(user => user.email === values[1])) throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' })
      state.users.push({ id: values[0], email: values[1], password_hash: values[2], email_verified_at: null })
    } else if (sql.includes('FROM sessions s JOIN users')) {
      const session = state.sessions.find(session => session.token_hash === values[0] && session.expires_at > new Date())
      return [session ? [{ ...state.users.find(user => user.id === session.user_id), ...session }] : []]
    } else if (sql.startsWith('SELECT') && sql.includes('FROM users WHERE email=')) return [state.users.filter(user => user.email === values[0])]
    else if (sql.startsWith('INSERT INTO sessions')) state.sessions.push({ token_hash: values[0], user_id: values[1], csrf_token: values[2], expires_at: values[3] })
    else if (sql.startsWith('DELETE FROM sessions WHERE token_hash=')) state.sessions = state.sessions.filter(session => session.token_hash !== values[0])
    else if (sql.startsWith('DELETE FROM sessions WHERE user_id=')) state.sessions = state.sessions.filter(session => session.user_id !== values[0])
    else if (sql.startsWith('DELETE FROM auth_tokens')) state.tokens = state.tokens.filter(token => !(token.user_id === values[0] && token.purpose === values[1]))
    else if (sql.startsWith('INSERT INTO auth_tokens')) state.tokens.push({ id: values[0], user_id: values[1], token_hash: values[2], purpose: values[3], expires_at: values[4] })
    else if (sql.startsWith('SELECT id,user_id FROM auth_tokens')) return [state.tokens.filter(token => token.token_hash === values[0] && token.purpose === values[1] && token.expires_at > new Date())]
    else if (sql.startsWith('UPDATE users SET email_verified_at=')) state.users.find(user => user.id === values[0]).email_verified_at = new Date()
    else if (sql.startsWith('UPDATE users SET password_hash=')) state.users.find(user => user.id === values[1]).password_hash = values[0]
    else if (sql.startsWith('SELECT password_hash FROM users WHERE id=')) return [state.users.filter(user => user.id === values[0])]
    else throw new Error(`unhandled SQL: ${sql}`)
    return [{ affectedRows: 1 }]
  }
  return { state, execute, async getConnection() {
    let snapshot
    return { execute, async beginTransaction() { snapshot = structuredClone(state) }, async commit() {}, async rollback() { Object.assign(state, snapshot) }, release() {} }
  } }
}

const config = { registrationEnabled: true, smtpUrl: 'smtp://localhost', mailFrom: 'mail@example.com', appOrigin: 'https://example.com', production: true }
const post = (value, headers = {}) => ({ ...body(value), headers: { ...body(value).headers, Origin: 'https://example.com', ...headers } })

test('register, verify, login and logout preserve only token hashes and one-time verification', async () => {
  const database = memoryDatabase(), mail = []
  const api = await serve(database, { config, sendMail: async message => mail.push(message) })
  try {
    const response = await api.request('/api/auth/register', post({ email: ' A@Example.COM ', password: 'long enough password 123' }))
    assert.equal(response.status, 201)
    const session = await response.json(), cookie = response.headers.get('set-cookie').split(';')[0]
    assert.equal(session.user.email, 'a@example.com')
    assert.equal(session.user.email_verified, false)
    assert.match(response.headers.get('set-cookie'), /HttpOnly/)
    assert.match(response.headers.get('set-cookie'), /Secure/)
    assert.match(response.headers.get('set-cookie'), /SameSite=Lax/)
    const encoded = database.state.users[0].password_hash.split('$')
    assert.equal(encoded[1], 'argon2id')
    assert.deepEqual(encoded[3].split(',').sort(), ['m=19456', 'p=1', 't=2'])
    const token = new URL(`https://example.com/${mail[0].text.match(/#auth=[^\s]+/)[0]}`).hash.match(/token=([a-f0-9]+)/)[1]
    assert.equal(database.state.tokens[0].token_hash, hash(token))
    assert.ok(!JSON.stringify(session).includes(token))
    assert.notEqual(database.state.sessions[0].token_hash, cookie.split('=')[1])
    assert.equal((await api.request('/api/auth/verify-email', post({ token }))).status, 200)
    assert.equal((await api.request('/api/auth/verify-email', post({ token }))).status, 400)
    const verified = await (await api.request('/api/auth/session', { headers: { Cookie: cookie } })).json()
    assert.equal(verified.user.email_verified, true)
    assert.equal((await api.request('/api/auth/logout', post({}, { Cookie: cookie, 'X-CSRF-Token': session.csrfToken }))).status, 200)
    assert.equal((await (await api.request('/api/auth/session', { headers: { Cookie: cookie } })).json()).user, null)
    assert.equal((await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'wrong long password' }))).status, 401)
    assert.equal((await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'long enough password 123' }))).status, 200)
  } finally { await api.close() }
})

test('password reset is one-time, revokes existing sessions and changes accepted credentials', async () => {
  const database = memoryDatabase(), mail = []
  const api = await serve(database, { config, sendMail: async message => mail.push(message) })
  try {
    const registered = await api.request('/api/auth/register', post({ email: 'a@example.com', password: 'long enough password 123' }))
    const cookie = registered.headers.get('set-cookie').split(';')[0]
    assert.equal((await api.request('/api/auth/forgot-password', post({ email: 'a@example.com' }))).status, 200)
    const token = mail[1].text.match(/token=([a-f0-9]+)/)[1]
    assert.equal((await api.request('/api/auth/reset-password', post({ token, password: 'replacement password 456' }))).status, 200)
    assert.equal((await api.request('/api/auth/reset-password', post({ token, password: 'replacement password 456' }))).status, 400)
    assert.equal((await (await api.request('/api/auth/session', { headers: { Cookie: cookie } })).json()).user, null)
    assert.equal((await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'long enough password 123' }))).status, 401)
    assert.equal((await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'replacement password 456' }))).status, 200)
  } finally { await api.close() }
})

test('forgot-password remains generic when delivery fails for a known account', async () => {
  const database = memoryDatabase()
  database.state.users.push({ ...user })
  const api = await serve(database, { config, sendMail: async () => { throw new Error('SMTP refused') } })
  try {
    const known = await api.request('/api/auth/forgot-password', post({ email: 'a@example.com' }))
    const unknown = await api.request('/api/auth/forgot-password', post({ email: 'missing@example.com' }))
    assert.equal(known.status, unknown.status)
    assert.deepEqual(await known.json(), await unknown.json())
  } finally { await api.close() }
})

test('login locks the password row until session insertion to serialize password revocation', async () => {
  const database = memoryDatabase(), queries = []
  const execute = database.execute
  database.execute = async (sql, values) => { queries.push(sql); return execute(sql, values) }
  const getConnection = database.getConnection
  database.getConnection = async () => { const connection = await getConnection(); connection.execute = database.execute; return connection }
  const api = await serve(database, { config, sendMail: async () => {} })
  try {
    await api.request('/api/auth/register', post({ email: 'a@example.com', password: 'long enough password 123' }))
    assert.equal((await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'long enough password 123' }))).status, 200)
    assert.match(queries.find(sql => sql.includes('password_hash') && sql.includes('WHERE email=')), /FOR UPDATE$/)
  } finally { await api.close() }
})

test('password work has a process-wide concurrency cap against distributed resource exhaustion', async () => {
  const api = await serve(memoryDatabase(), { config, sendMail: async () => {} })
  try {
    const replies = await Promise.all(Array.from({ length: 12 }, (_, index) => api.request('/api/auth/register', post({ email: `user${index}@example.com`, password: 'long enough password 123' }))))
    assert.ok(replies.some(response => response.status === 429), 'excess simultaneous Argon2 operations must be rejected')
    assert.ok(replies.filter(response => response.status === 429).every(response => Number(response.headers.get('Retry-After')) > 0))
    assert.ok(replies.some(response => response.status === 201), 'admitted operations should still succeed')
  } finally { await api.close() }
})

test('login recovers after its first dummy password hash is rejected by the concurrency gate', async () => {
  const api = await serve(memoryDatabase(), { config, sendMail: async () => {} })
  const originalHash = argon2.hash
  let releaseHash, notifyStarted, started = 0, pending = []
  const hold = new Promise(resolve => { releaseHash = resolve })
  const allStarted = new Promise(resolve => { notifyStarted = resolve })
  argon2.hash = async (...args) => {
    if (++started === 4) notifyStarted()
    await hold
    return originalHash(...args)
  }
  try {
    pending = Array.from({ length: 4 }, (_, index) => api.request('/api/auth/register', post({ email: `user${index}@example.com`, password: 'long enough password 123' })))
    await allStarted
    assert.equal((await api.request('/api/auth/login', post({ email: 'user0@example.com', password: 'long enough password 123' }))).status, 429)
    releaseHash()
    await Promise.all(pending)
    assert.equal((await api.request('/api/auth/login', post({ email: 'user0@example.com', password: 'long enough password 123' }))).status, 200)
  } finally { releaseHash(); await Promise.allSettled(pending); argon2.hash = originalHash; await api.close() }
})

test('changing a password revokes every session and pending reset credential', async () => {
  const database = memoryDatabase(), mail = []
  const api = await serve(database, { config, sendMail: async message => mail.push(message) })
  try {
    const registered = await api.request('/api/auth/register', post({ email: 'a@example.com', password: 'long enough password 123' }))
    const cookie = registered.headers.get('set-cookie').split(';')[0], session = await registered.json()
    await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'long enough password 123' }))
    await api.request('/api/auth/forgot-password', post({ email: 'a@example.com' }))
    const resetToken = mail[1].text.match(/token=([a-f0-9]+)/)[1]
    const changed = await api.request('/api/auth/change-password', post({ currentPassword: 'long enough password 123', password: 'replacement password 456' }, { Cookie: cookie, 'X-CSRF-Token': session.csrfToken }))
    assert.equal(changed.status, 200)
    assert.equal(database.state.sessions.length, 0)
    assert.equal((await api.request('/api/auth/reset-password', post({ token: resetToken, password: 'third password 789' }))).status, 400)
    assert.equal((await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'long enough password 123' }))).status, 401)
    assert.equal((await api.request('/api/auth/login', post({ email: 'a@example.com', password: 'replacement password 456' }))).status, 200)
  } finally { await api.close() }
})
