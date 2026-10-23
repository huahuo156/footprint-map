import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'
import { createJournalRouter } from './journal.js'

export const uploadDirectory = fileURLToPath(new URL('../uploads/', import.meta.url))
mkdirSync(uploadDirectory, { recursive: true })
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_req, file, cb) => cb(null, randomUUID() + extensions[file.mimetype]),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(extensions[file.mimetype] ? null : badRequest('仅支持 JPG/PNG/WebP 图片'), !!extensions[file.mimetype]),
})
export const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))
app.use('/uploads', express.static(uploadDirectory, { dotfiles: 'deny' }))
app.use('/api/journal', createJournalRouter(uploadDirectory))

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 })
}
function text(value, max, required = false) {
  if (value == null && !required) return null
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw badRequest('字段内容无效或过长')
  return value.trim() || null
}
function positiveInt(value) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw badRequest('无效的 ID')
  return number
}
function pagination(query, defaultLimit) {
  const limit = Number(query.limit ?? defaultLimit)
  const offset = Number(query.offset ?? 0)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) throw badRequest('无效的分页参数')
  return [limit, offset]
}
app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', database: 'mysql' })
})
app.post('/api/uploads/:kind', (req, res, next) => {
  if (!['guide-covers', 'checkin-images'].includes(req.params.kind)) return next(badRequest('无效的图片类型'))
  upload.single('image')(req, res, async error => {
    if (error) return next(error)
    if (!req.file) return next(badRequest('请选择图片'))
    const max = req.params.kind === 'guide-covers' ? 5 : 10
    if (req.file.size > max * 1024 * 1024) {
      await unlink(req.file.path).catch(() => {})
      return next(badRequest(`图片大小不能超过 ${max}MB`))
    }
    res.status(201).json({ url: `/uploads/${req.file.filename}` })
  })
})
app.get('/api/landmarks', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM landmarks ORDER BY name')
  res.json(rows)
})
app.get('/api/checkins', async (req, res) => {
  const province = text(req.query.province, 64)
  const all = req.query.all === 'true'
  const page = pagination(req.query, 50)
  const [rows] = await pool.query(`SELECT * FROM checkins ${province ? 'WHERE province=?' : ''} ORDER BY created_at DESC, id DESC ${all ? '' : 'LIMIT ? OFFSET ?'}`, [...(province ? [province] : []), ...(all ? [] : page)])
  res.json(rows)
})
app.post('/api/checkins', async (req, res) => {
  const { lat, lng } = req.body
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw badRequest('无效的经纬度')
  const image = text(req.body.image_url, 2048, true)
  if (!/^\/uploads\/[\w-]+\.(jpg|png|webp)$/.test(image)) throw badRequest('请先上传打卡图片')
  const landmark = req.body.landmark_id == null ? null : positiveInt(req.body.landmark_id)
  const [result] = await pool.execute('INSERT INTO checkins (landmark_id, lat, lng, image_url, caption, province) VALUES (?, ?, ?, ?, ?, ?)', [landmark, lat, lng, image, text(req.body.caption, 10000), text(req.body.province, 64)])
  const [[row]] = await pool.execute('SELECT * FROM checkins WHERE id=?', [result.insertId])
  res.status(201).json(row)
})
app.get('/api/guides', async (req, res) => {
  const province = text(req.query.province, 64)
  const [rows] = await pool.query(`SELECT * FROM guides ${province ? 'WHERE province=?' : ''} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [...(province ? [province] : []), ...pagination(req.query, 20)])
  res.json(rows)
})
app.get('/api/guides/:id', async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM guides WHERE id=?', [positiveInt(req.params.id)])
  if (!rows.length) return res.status(404).json({ error: '攻略不存在' })
  res.json(rows[0])
})
app.post('/api/guides', async (req, res) => {
  const ids = req.body.landmark_ids ?? []
  if (!Array.isArray(ids) || ids.length > 500) throw badRequest('无效的景点列表')
  ids.forEach(positiveInt)
  const [result] = await pool.execute('INSERT INTO guides (title, content, cover_image_url, province, landmark_ids) VALUES (?, ?, ?, ?, ?)', [text(req.body.title, 255, true), text(req.body.content, 1000000), text(req.body.cover_image_url, 2048), text(req.body.province, 64), JSON.stringify(ids)])
  const [[row]] = await pool.execute('SELECT * FROM guides WHERE id=?', [result.insertId])
  res.status(201).json(row)
})
function likeTarget(req) {
  const type = req.params.type
  if (!['checkin', 'guide'].includes(type)) throw badRequest('无效的点赞类型')
  return { type, table: type === 'checkin' ? 'checkins' : 'guides', id: positiveInt(req.params.id) }
}
app.get('/api/likes/:type/:id', async (req, res) => {
  const { type, id } = likeTarget(req)
  const [rows] = await pool.execute('SELECT target_id FROM likes WHERE target_type=? AND target_id=?', [type, id])
  res.json({ liked: rows.length > 0 })
})
app.post('/api/likes/:type/:id', async (req, res) => {
  const { type, table, id } = likeTarget(req)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[target]] = await connection.execute(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`, [id])
    if (!target) {
      await connection.rollback()
      return res.status(404).json({ error: '记录不存在' })
    }
    const [existing] = await connection.execute('SELECT target_id FROM likes WHERE target_type=? AND target_id=?', [type, id])
    const liked = !existing.length
    if (liked) await connection.execute('INSERT INTO likes (target_type, target_id) VALUES (?, ?)', [type, id])
    else await connection.execute('DELETE FROM likes WHERE target_type=? AND target_id=?', [type, id])
    await connection.execute(`UPDATE ${table} SET likes_count=? WHERE id=?`, [liked ? 1 : 0, id])
    await connection.commit()
    res.json({ liked, count: liked ? 1 : 0 })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
})
app.post('/api/search', async (req, res) => {
  const query = text(req.body.query, 200, true)
  const [limit] = pagination({ limit: req.body.limit }, 20)
  const pattern = `%${query.replace(/[!%_]/g, '!$&')}%`
  const [results] = await pool.query("SELECT * FROM checkins WHERE caption LIKE ? ESCAPE '!' OR province LIKE ? ESCAPE '!' ORDER BY created_at DESC LIMIT ?", [pattern, pattern, limit])
  res.json({ results })
})
const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
app.use(express.static(distDirectory))
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return res.status(404).json({ error: '资源不存在' })
  if (req.method !== 'GET') return next()
  res.sendFile(path.join(distDirectory, 'index.html'))
})
app.use((error, _req, res, _next) => {
  const status = error instanceof multer.MulterError || error.code === 'ER_NO_REFERENCED_ROW_2' ? 400 : error.status || 500
  if (status >= 500) console.error(error)
  res.status(status).json({ error: status >= 500 ? '数据库或服务异常，请查看后端日志' : error.message, ...(error.code === 'INVALID_IMAGES' ? { code: error.code, invalidFiles: error.invalidFiles } : {}) })
})
