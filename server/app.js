import express from 'express'
import multer from 'multer'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { createJournalRouter } from './journal.js'
import { backupRoutes } from './backup.js'
import { createPlaceSearchRouter } from './place-search.js'
import { createAuthRouter, requireAuth, requireVerified, csrfProtection, rateLimit } from './auth.js'
import { assertOwnedAsset } from './assets.js'

export const uploadDirectory = process.env.UPLOAD_DIRECTORY ? path.resolve(process.env.UPLOAD_DIRECTORY) : fileURLToPath(new URL('../uploads/', import.meta.url))
mkdirSync(uploadDirectory, { recursive: true })
export const app = express()
app.disable('x-powered-by')
if (process.env.TRUST_PROXY_HOPS) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS))
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)', 'Content-Security-Policy-Report-Only': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.amap.com https://*.autonavi.com; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" })
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) res.set('Cache-Control', 'private, no-store')
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000')
  next()
})
app.use(express.json({ limit: '2mb' }))
app.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'mysql' }) })
app.use('/api/auth', createAuthRouter())
// Retire single-user endpoints so they cannot bypass the ownership model.
app.use(['/api/checkins', '/api/guides', '/api/likes', '/api/search', '/api/uploads'], (_req, res) => res.status(410).json({ error: '旧版共享接口已停用，请使用旅行手帐。' }))
app.get('/api/landmarks', async (_req, res) => { const [rows] = await pool.query('SELECT * FROM landmarks ORDER BY name'); res.json(rows) })
app.use('/api', requireAuth, csrfProtection)
const expensive = rateLimit({ max: 30, windowMs: 60000, key: req => req.user.id })
app.use('/api/journal', (req, res, next) => {
  if (['POST', 'PUT'].includes(req.method) && ['/entries', '/notebook-covers', '/restore'].some(route => req.path === route || req.path.startsWith(route + '/'))) return requireVerified(req, res, error => error ? next(error) : expensive(req, res, next))
  next()
})
app.use('/api/journal/backup', rateLimit({ max: 5, windowMs: 60000, key: req => req.user.id }))
app.use('/api/journal/restore', rateLimit({ max: 3, windowMs: 3600000, key: req => req.user.id }))
const journalRouter = createJournalRouter(uploadDirectory)
backupRoutes(journalRouter, uploadDirectory)
app.use('/api/journal', journalRouter)
app.use('/api/places', rateLimit({ max: 30, windowMs: 60000 }), rateLimit({ max: 30, windowMs: 60000, key: req => req.user.id }), createPlaceSearchRouter())
app.use('/uploads', requireAuth, async (req, res, next) => {
  try {
    const key = await assertOwnedAsset('/uploads' + req.path)
    res.sendFile(key, { root: uploadDirectory, dotfiles: 'deny', cacheControl: false, lastModified: false, headers: { 'Cache-Control': 'private, no-store' } }, error => { if (error) next(error) })
  } catch (error) { next(error) }
})
const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
app.use(express.static(distDirectory))
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).json({ error: '资源不存在' })
  if (req.method !== 'GET') return next()
  res.sendFile(path.join(distDirectory, 'index.html'))
})
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error)
  const status = error instanceof multer.MulterError || error.code === 'ER_NO_REFERENCED_ROW_2' ? 400 : error.status || 500
  if (status >= 500) console.error('API request failed', { code: error.code || 'INTERNAL', name: error.name })
  res.status(status).json({ error: status >= 500 ? '数据库或服务异常，请查看后端日志' : error.message, ...(error.code === 'INVALID_IMAGES' ? { code: error.code, invalidFiles: error.invalidFiles } : {}) })
})
