import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import argon2 from 'argon2'
import { pool } from './db.js'
import { createLayoutUser } from './layout-session.js'
import { sendMail as defaultSendMail } from './mail.js'

const context = new AsyncLocalStorage()
// Internal background work uses an owner already authenticated by the API.
export const withUserContext = (ownerId, operation) => context.run({ id: ownerId }, operation)
const COOKIE = 'shitu_session'
const SESSION_MS = 7 * 24 * 60 * 60 * 1000
const hash = value => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('hex')
const failure = (status, message) => Object.assign(new Error(message), { status })
const publicUser = user => ({ id: user.id, email: user.email, email_verified: Boolean(user.email_verified_at) })
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
const environment = () => ({ registrationEnabled: process.env.AUTH_REGISTRATION_ENABLED === 'true', smtpUrl: process.env.SMTP_URL, mailFrom: process.env.MAIL_FROM, appOrigin: process.env.APP_ORIGIN, production: process.env.NODE_ENV === 'production' })

export function currentUserId() {
  const id = context.getStore()?.id
  if (!id) throw failure(401, '请先登录')
  return id
}

function cookieToken(req) {
  const value = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null
}

export function createAuthMiddleware({ database = pool, appOrigin = process.env.APP_ORIGIN } = {}) {
  async function resolve(req) {
    if (req.authResolved) return
    req.authResolved = true
    const token = cookieToken(req)
    if (!token) return
    const [[session]] = await database.execute(`SELECT u.id,u.email,u.email_verified_at,s.csrf_token,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(3)`, [hash(token)])
    if (!session || new Date(session.expires_at).getTime() <= Date.now()) return
    req.user = session
    req.auth = { csrfToken: session.csrf_token, tokenHash: hash(token) }
  }
  const requireAuth = asyncRoute(async (req, res, next) => {
    await resolve(req)
    if (!req.user) throw failure(401, '请先登录')
    context.run({ id: req.user.id }, next)
  })
  const requireVerified = (req, res, next) => {
    if (!req.user) return next(failure(401, '请先登录'))
    if (!req.user.email_verified_at) return next(failure(403, '请先验证邮箱'))
    next()
  }
  const csrfProtection = (req, res, next) => {
    if (!req.user || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const supplied = req.get('X-CSRF-Token') || ''
    const expected = req.auth?.csrfToken || ''
    if (!appOrigin || req.get('Origin') !== appOrigin || !/^[a-f0-9]{64}$/.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return next(failure(403, '请求验证失败，请刷新后重试'))
    next()
  }
  return { resolve, requireAuth, requireVerified, csrfProtection }
}
export const { requireAuth, requireVerified, csrfProtection } = createAuthMiddleware()

export function rateLimit({ windowMs = 15 * 60000, max = 20, key = req => req.ip, maxKeys = 10000 } = {}) {
  const entries = new Map()
  return (req, res, next) => {
    const now = Date.now(), id = String(key(req) || req.ip || 'unknown').slice(0, 512)
    for (const [entryKey, entry] of entries) if (entry.until <= now) entries.delete(entryKey)
    let entry = entries.get(id)
    if (!entry) {
      // Fail closed on capacity instead of evicting active limits.
      if (entries.size >= maxKeys) return res.set('Retry-After', String(Math.ceil(windowMs / 1000))).status(429).json({ error: '请求过于频繁，请稍后重试' })
      entry = { count: 0, until: now + windowMs }; entries.set(id, entry)
    }
    if (++entry.count > max) return res.set('Retry-After', String(Math.max(1, Math.ceil((entry.until - now) / 1000)))).status(429).json({ error: '请求过于频繁，请稍后重试' })
    next()
  }
}

function emailInput(value) {
  if (typeof value !== 'string') throw failure(400, '请输入有效邮箱')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure(400, '请输入有效邮箱')
  return email
}
function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128 || Buffer.byteLength(value) > 512) throw failure(400, '密码须为 12 至 128 个字符')
  return value
}
let activePasswordWork = 0
async function passwordWork(operation) {
  if (activePasswordWork >= 4) throw failure(429, '登录服务繁忙，请稍后重试')
  activePasswordWork++
  try { return await operation() }
  finally { activePasswordWork-- }
}
async function passwordHash(password) { return passwordWork(() => argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })) }
async function passwordVerify(encoded, password) { return passwordWork(() => argon2.verify(encoded, password)) }

export function createAuthRouter({ database = pool, sendMail = defaultSendMail, config = environment(), limiter = rateLimit } = {}) {
  const router = Router()
  const middleware = createAuthMiddleware({ database, appOrigin: config.appOrigin })
  const mailReady = () => Boolean(config.smtpUrl && config.mailFrom && /^https?:\/\/[^/]+$/.test(config.appOrigin || ''))
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: Boolean(config.production), path: '/' }
  const ipLimit = limiter({ scope: 'auth-ip', max: 30 })
  const accountLimit = limiter({ scope: 'auth-account', max: 10, key: req => typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : req.ip })
  let dummyHash
  router.use(asyncRoute(async (req, res, next) => { await middleware.resolve(req); next() }), middleware.csrfProtection)
  // Public credential submissions still require the configured same origin.
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && config.appOrigin && req.get('Origin') !== config.appOrigin) return next(failure(403, '请求来源无效'))
    next()
  })
  router.get('/session', (req, res) => { res.set('Cache-Control', 'no-store'); res.json({ user: req.user ? publicUser(req.user) : null, csrfToken: req.auth?.csrfToken || null }) })
  async function transaction(fn) {
    const connection = await database.getConnection()
    try { await connection.beginTransaction(); const result = await fn(connection); await connection.commit(); return result }
    catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
  }
  async function issueToken(user, purpose) {
    const token = secret(), expires = new Date(Date.now() + (purpose === 'verify' ? 24 * 60 : 30) * 60000)
    await transaction(async connection => {
      await connection.execute('DELETE FROM auth_tokens WHERE user_id=? AND purpose=?', [user.id, purpose])
      await connection.execute('INSERT INTO auth_tokens (id,user_id,token_hash,purpose,expires_at) VALUES (?,?,?,?,?)', [randomUUID(), user.id, hash(token), purpose, expires])
    })
    const action = purpose === 'verify' ? 'verify' : 'reset'
    await sendMail({ to: user.email, subject: purpose === 'verify' ? '拾途：验证邮箱' : '拾途：重置密码', text: `${purpose === 'verify' ? '验证邮箱' : '重置密码'}：${config.appOrigin}/#auth=${action}&token=${token}\n如非本人操作，请忽略此邮件。` })
  }
  async function createSession(user, res, executor = database) {
    const token = secret(), csrfToken = secret()
    await executor.execute('INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)', [hash(token), user.id, csrfToken, new Date(Date.now() + SESSION_MS)])
    res.cookie(COOKIE, token, { ...cookieOptions, maxAge: SESSION_MS })
    return { user: publicUser(user), csrfToken }
  }
  router.post('/register', ipLimit, accountLimit, asyncRoute(async (req, res) => {
    if (!config.registrationEnabled || !mailReady()) throw failure(503, '注册暂未开放，请等待管理员配置邮件服务')
    const email = emailInput(req.body?.email), password = passwordInput(req.body?.password)
    const user = { id: randomUUID(), email, email_verified_at: null }
    try { await createLayoutUser(database, { id: user.id, email, passwordHash: await passwordHash(password) }) }
    catch (error) { if (error.code === 'ER_DUP_ENTRY') throw failure(409, '该邮箱无法注册，请尝试登录或找回密码'); throw error }
    await issueToken(user, 'verify')
    res.status(201).json(await createSession(user, res))
  }))
  router.post('/login', ipLimit, accountLimit, asyncRoute(async (req, res) => {
    const email = emailInput(req.body?.email), password = passwordInput(req.body?.password)
    // A real hash on unknown accounts avoids a cheap account enumeration timing path.
    dummyHash ||= passwordHash(secret()).catch(error => { dummyHash = undefined; throw error })
    const fallback = await dummyHash
    const session = await transaction(async connection => {
      // Password changes and resets lock this same row: a login using the old
      // password must never insert its session after those operations revoke it.
      const [[user]] = await connection.execute('SELECT id,email,password_hash,email_verified_at FROM users WHERE email=? FOR UPDATE', [email])
      if (!await passwordVerify(user?.password_hash || fallback, password) || !user) throw failure(401, '邮箱或密码错误')
      if (req.auth) await connection.execute('DELETE FROM sessions WHERE token_hash=?', [req.auth.tokenHash])
      return createSession(user, res, connection)
    })
    res.json(session)
  }))
  router.post('/logout', middleware.requireAuth, asyncRoute(async (req, res) => {
    await database.execute('DELETE FROM sessions WHERE token_hash=?', [req.auth.tokenHash])
    res.clearCookie(COOKIE, cookieOptions).json({ ok: true })
  }))
  router.post('/resend-verification', ipLimit, middleware.requireAuth, asyncRoute(async (req, res) => {
    if (!mailReady()) throw failure(503, '邮件服务尚未配置')
    if (!req.user.email_verified_at) await issueToken(req.user, 'verify')
    res.json({ ok: true })
  }))
  router.post('/forgot-password', ipLimit, accountLimit, asyncRoute(async (req, res) => {
    if (!mailReady()) throw failure(503, '邮件服务尚未配置')
    const email = emailInput(req.body?.email)
    const [[user]] = await database.execute('SELECT id,email FROM users WHERE email=?', [email])
    // Delivery/provider failures cannot reveal whether this address has an
    // account. SMTP health is monitored independently; never log credential mail.
    if (user) await issueToken(user, 'reset').catch(() => {})
    res.json({ ok: true })
  }))
  async function consumeToken(req, purpose, action) {
    const token = req.body?.token
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw failure(400, '链接无效或已过期')
    return transaction(async connection => {
      const [[record]] = await connection.execute('SELECT id,user_id FROM auth_tokens WHERE token_hash=? AND purpose=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE', [hash(token), purpose])
      if (!record) throw failure(400, '链接无效或已过期')
      await action(connection, record.user_id)
      await connection.execute('DELETE FROM auth_tokens WHERE user_id=? AND purpose=?', [record.user_id, purpose])
    })
  }
  router.post('/verify-email', ipLimit, asyncRoute(async (req, res) => {
    await consumeToken(req, 'verify', (connection, id) => connection.execute('UPDATE users SET email_verified_at=COALESCE(email_verified_at,UTC_TIMESTAMP(3)) WHERE id=?', [id]))
    res.json({ ok: true })
  }))
  router.post('/reset-password', ipLimit, asyncRoute(async (req, res) => {
    const encoded = await passwordHash(passwordInput(req.body?.password))
    await consumeToken(req, 'reset', async (connection, id) => {
      await connection.execute('UPDATE users SET password_hash=? WHERE id=?', [encoded, id])
      await connection.execute('DELETE FROM sessions WHERE user_id=?', [id])
    })
    res.clearCookie(COOKIE, cookieOptions).json({ ok: true })
  }))
  router.post('/change-password', ipLimit, middleware.requireAuth, asyncRoute(async (req, res) => {
    const password = passwordInput(req.body?.password), oldPassword = passwordInput(req.body?.currentPassword)
    await transaction(async connection => {
      const [[user]] = await connection.execute('SELECT password_hash FROM users WHERE id=? FOR UPDATE', [req.user.id])
      if (!user || !await passwordVerify(user.password_hash, oldPassword)) throw failure(401, '当前密码错误')
      await connection.execute('UPDATE users SET password_hash=? WHERE id=?', [await passwordHash(password), req.user.id])
      await connection.execute('DELETE FROM sessions WHERE user_id=?', [req.user.id])
      await connection.execute('DELETE FROM auth_tokens WHERE user_id=? AND purpose=?', [req.user.id, 'reset'])
    })
    res.clearCookie(COOKIE, cookieOptions).json({ ok: true })
  }))
  router.use((error, req, res, next) => {
    if (error.status === 429 && !res.headersSent) res.set('Retry-After', '1')
    next(error)
  })
  return router
}
