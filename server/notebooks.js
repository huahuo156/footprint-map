import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { access, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pool } from './db.js'
import { currentUserId } from './auth.js'
import { assertOwnedAsset, registerAsset, normalizeImageBuffer } from './assets.js'
import { collectUnusedAssets, reclaimAssets } from './asset-lifecycle.js'

// Per-kind tables provide real source foreign keys and one page membership per item.
const tables = { photo: 'journal_photos', mark: 'journal_marks', entry: 'journal_entries' }
const fail = (message, status = 400) => {
  throw Object.assign(new Error(message), { status })
}
const uuid = (value) => {
  if (typeof value !== 'string' || !/^[a-f\d-]{36}$/i.test(value)) fail('编号无效')
  return value
}
const numeric = (value, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('位置超出范围')
  return value
}
const name = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) fail('手帐名称无效')
  return value.trim()
}
const coverText = (value, max, message) => {
  if (typeof value !== 'string' || value.length > max) fail(message)
  return value.trim()
}
const cover = (value) => {
  if (value == null || value === '') return null
  if (
    typeof value !== 'string' ||
    !/^\/(uploads\/[\w-]+\.(jpg|png|webp)|journal-demo\/[\w-]+\.(jpg|png|webp)|notebook-covers\/[\w-]+\.jpg)$/.test(value)
  )
    fail('封面图片无效')
  return value
}
const coverMode = value => {
  if (!['photo', 'solid', 'text'].includes(value)) fail('封面样式无效')
  return value
}
const coverColor = value => {
  if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) fail('封面颜色无效')
  return value
}
const uploadedCover = value => typeof value === 'string' && /^\/uploads\/cover-[\da-f-]{36}\.(jpg|png|webp)$/.test(value)
async function verifyCoverFile(url, uploadDirectory, connection) {
  if (url?.startsWith('/uploads/')) await assertOwnedAsset(url, connection)
  if (uploadedCover(url)) {
    if (!uploadDirectory) fail('封面上传目录不可用')
    await access(path.join(uploadDirectory, path.basename(url))).catch(() => fail('封面图片已不存在'))
  }
}
export async function transaction(fn, lockCovers = false) {
  const connection = await pool.getConnection()
  const lockName = 'shitu-cover:' + currentUserId()
  let coverLocked = false
  try {
    if (lockCovers) {
      const [[lock]] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName])
      if (!lock?.acquired) fail('封面正在更新，请稍后重试', 409)
      coverLocked = true
    }
    await connection.beginTransaction()
    await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [currentUserId()])
    const result = await fn(connection)
    await connection.commit()
    return result
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    try {
      if (coverLocked) await connection.query('SELECT RELEASE_LOCK(?)', [lockName])
    } finally { connection.release() }
  }
}
export async function requirePage(connection, value) {
  const pageId = uuid(value)
  const [[page]] = await connection.execute('SELECT p.* FROM journal_notebook_pages p JOIN journal_notebooks b ON b.id=p.notebook_id WHERE p.id=? AND b.owner_id=? FOR UPDATE', [
    pageId, currentUserId()
  ])
  if (!page) fail('页面已不存在', 404)
  return page
}
// Source canvas coordinates stay untouched so detaching restores the prior canvas position.
export async function placeItem(connection, pageId, item) {
  await requirePage(connection, pageId)
  const table = tables[item.kind]
  if (!table) fail('内容类型无效')
  uuid(item.id)
  numeric(item.x, 0, 1200)
  numeric(item.y, 0, 1600)
  numeric(item.rotation ?? 0, -20, 20)
  const [[source]] = await connection.execute(`SELECT id FROM ${table} WHERE id=? AND ${item.kind === 'photo' ? 'EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=journal_photos.entry_id AND e.owner_id=?)' : 'owner_id=?'} FOR UPDATE`, [item.id, currentUserId()])
  if (!source) fail('内容已不存在', 404)
  if (item.kind === 'entry') {
    const [photos] = await connection.execute('SELECT id FROM journal_photos WHERE entry_id=? AND EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=journal_photos.entry_id AND e.owner_id=?)', [item.id, currentUserId()])
    if (photos.length) fail('请选择记录中的照片')
  }
  if (item.kind === 'photo')
    await connection.execute('DELETE FROM journal_canvas_group_photos WHERE photo_id=? AND EXISTS (SELECT 1 FROM journal_canvas_groups g WHERE g.id=journal_canvas_group_photos.group_id AND g.owner_id=?)', [item.id, currentUserId()])
  await connection.execute(
    `INSERT INTO journal_notebook_${item.kind}_items (id,page_id,x,y,rotation) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE page_id=VALUES(page_id),x=VALUES(x),y=VALUES(y),rotation=VALUES(rotation)`,
    [item.id, pageId, item.x, item.y, item.rotation ?? 0]
  )
}
function items(value, position = true) {
  if (!Array.isArray(value) || !value.length || value.length > 500) fail('请选择内容')
  const used = new Set()
  for (const i of value) {
    if (!i || !Object.hasOwn(tables, i.kind)) fail('内容类型无效')
    uuid(i.id)
    const key = i.kind + i.id
    if (used.has(key)) fail('内容重复')
    used.add(key)
    if (position) {
      numeric(i.x, 0, 1200)
      numeric(i.y, 0, 1600)
      numeric(i.rotation ?? 0, -20, 20)
    }
  }
  return value
}
async function bookPages(connection, id) {
  const [[book]] = await connection.execute('SELECT id FROM journal_notebooks WHERE id=? AND owner_id=? FOR UPDATE', [
    uuid(id), currentUserId()
  ])
  if (!book) fail('手帐已不存在', 404)
  const [pages] = await connection.execute(
    'SELECT * FROM journal_notebook_pages WHERE notebook_id=? AND EXISTS (SELECT 1 FROM journal_notebooks b WHERE b.id=journal_notebook_pages.notebook_id AND b.owner_id=?) ORDER BY sort_order,id FOR UPDATE',
    [id, currentUserId()]
  )
  return pages
}
export async function readNotebooks() {
  const [notebooks] = await pool.query(
    'SELECT id,name,cover_url,cover_label,cover_text,cover_mode,cover_color,bookmark_page_id,last_read_page_id,canvas_x,canvas_y,rotation FROM journal_notebooks WHERE owner_id=? ORDER BY created_at,id', [currentUserId()]
  )
  const [notebook_pages] = await pool.query(
    'SELECT p.* FROM journal_notebook_pages p JOIN journal_notebooks b ON b.id=p.notebook_id WHERE b.owner_id=? ORDER BY p.notebook_id,p.sort_order,p.id', [currentUserId()]
  )
  const notebook_items = []
  for (const kind of Object.keys(tables)) {
    const [rows] = await pool.query(`SELECT i.* FROM journal_notebook_${kind}_items i JOIN journal_notebook_pages p ON p.id=i.page_id JOIN journal_notebooks b ON b.id=p.notebook_id JOIN ${tables[kind]} s ON s.id=i.id ${kind === 'photo' ? 'JOIN journal_entries e ON e.id=s.entry_id' : ''} WHERE b.owner_id=? AND ${kind === 'photo' ? 'e' : 's'}.owner_id=b.owner_id ORDER BY i.id`, [currentUserId()])
    notebook_items.push(...rows.map((r) => ({ ...r, kind })))
  }
  return { notebooks: notebooks.map(book => ({ ...book, cover_label: book.cover_label ?? 'MEMO', cover_text: book.cover_text ?? '', cover_mode: book.cover_mode ?? (book.cover_url ? 'photo' : 'solid'), cover_color: book.cover_color ?? '#e3e9dd' })), notebook_pages, notebook_items }
}
export function notebookRoutes(router, uploadDirectory) {
  const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 0 },
    fileFilter: (_req, file, cb) => cb(extensions[file.mimetype] ? null : Object.assign(new Error('请选择 JPG、PNG 或 WebP 图片'), { status: 400 }), !!extensions[file.mimetype]) })
  router.post('/notebook-covers', upload.single('image'), async (req, res) => {
    if (!req.file) fail('请选择封面图片')
    const normalized = await normalizeImageBuffer(req.file.buffer, req.file.mimetype)
    const b = normalized.data
    const filename = 'cover-' + randomUUID() + normalized.extension
    const target = path.join(uploadDirectory, filename)
    try {
      await writeFile(target, b, { flag: 'wx' })
      await registerAsset({filename,path:target,size:b.length,mimetype:normalized.mime})
      res.status(201).json({ url: '/uploads/' + filename })
    } catch (error) {
      if (error.code !== 'EEXIST') await unlink(target).catch(() => {})
      throw error
    }
  })
  router.delete('/notebook-covers', async (req, res) => {
    const url = req.query.url
    if (!uploadedCover(url)) fail('封面图片无效')
    await assertOwnedAsset(url)
    const result = await collectUnusedAssets(uploadDirectory, { urls: [url] })
    if (result.retained) fail('封面仍被照片或手帐使用', 409)
    res.json({ deleted: url })
  })
  router.use(['/notebooks', '/notebook-pages', '/notebook-items'], (req, _res, next) => {
    if (req.body == null) req.body = {}
    if (typeof req.body !== 'object' || Array.isArray(req.body)) fail('请求内容无效')
    next()
  })
  router.post('/notebooks', async (req, res) => {
    const notebook = {
      id: randomUUID(),
      name: name(req.body.name),
      cover_url: cover(req.body.cover_url),
      cover_mode: Object.hasOwn(req.body, 'cover_mode') ? coverMode(req.body.cover_mode) : (req.body.cover_url ? 'photo' : 'solid'),
      cover_color: Object.hasOwn(req.body, 'cover_color') ? coverColor(req.body.cover_color) : '#e3e9dd',
      cover_label: Object.hasOwn(req.body, 'cover_label') ? coverText(req.body.cover_label, 60, '封面字样无效（最多60字）') : 'MEMO',
      cover_text: Object.hasOwn(req.body, 'cover_text') ? coverText(req.body.cover_text, 500, '封面寄语无效（最多500字）') : '',
      canvas_x: numeric(req.body.canvas_x ?? 0, -1e7, 1e7),
      canvas_y: numeric(req.body.canvas_y ?? 0, -1e7, 1e7),
      rotation: 0
    }
    await transaction(async (connection) => {
      await verifyCoverFile(notebook.cover_url, uploadDirectory, connection)
      await connection.execute(
        'INSERT INTO journal_notebooks (id,owner_id,name,cover_url,cover_label,cover_text,cover_mode,cover_color,canvas_x,canvas_y) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [notebook.id, currentUserId(), notebook.name, notebook.cover_url, notebook.cover_label, notebook.cover_text, notebook.cover_mode, notebook.cover_color, notebook.canvas_x, notebook.canvas_y]
      )
      for (let i = 0; i < 4; i++)
        await connection.execute(
          'INSERT INTO journal_notebook_pages (id,notebook_id,sort_order) VALUES (?,?,?)',
          [randomUUID(), notebook.id, i]
        )
    }, true)
    res.status(201).json(notebook)
  })
  router.patch('/notebooks/:id', async (req, res) => {
    const fields = {}
    for (const key of ['name', 'cover_url', 'cover_label', 'cover_text', 'cover_mode', 'cover_color', 'canvas_x', 'canvas_y', 'rotation'])
      if (Object.hasOwn(req.body, key))
        fields[key] =
          key === 'cover_mode' ? coverMode(req.body[key]) : key === 'cover_color' ? coverColor(req.body[key]) : key === 'name'
            ? name(req.body[key])
            : key === 'cover_url'
              ? cover(req.body[key])
              : key === 'cover_label'
                ? coverText(req.body[key], 60, '封面字样无效（最多60字）')
                : key === 'cover_text'
                  ? coverText(req.body[key], 500, '封面寄语无效（最多500字）')
                  : numeric(req.body[key], key === 'rotation' ? -20 : -1e7, key === 'rotation' ? 20 : 1e7)
    if (!Object.keys(fields).length) fail('请选择修改内容')
    const previousCover = await transaction(async (connection) => {
      await verifyCoverFile(fields.cover_url, uploadDirectory, connection)
      await bookPages(connection, req.params.id)
      const [[previous]] = await connection.execute('SELECT cover_url FROM journal_notebooks WHERE id=? AND owner_id=?', [req.params.id, currentUserId()])
      await connection.execute(
        `UPDATE journal_notebooks SET ${Object.keys(fields)
          .map((k) => k + '=?')
          .join(',')} WHERE id=? AND owner_id=?`,
        [...Object.values(fields), req.params.id, currentUserId()]
      )
      return previous.cover_url
    }, true)
    if (Object.hasOwn(fields, 'cover_url') && previousCover !== fields.cover_url) await reclaimAssets(uploadDirectory, [previousCover])
    res.json({ id: req.params.id, ...fields })
  })
  router.delete('/notebooks/:id', async (req, res) => {
    const previousCover = await transaction(async (connection) => {
      await bookPages(connection, req.params.id)
      const [[previous]] = await connection.execute('SELECT cover_url FROM journal_notebooks WHERE id=? AND owner_id=?', [req.params.id, currentUserId()])
      await connection.execute('DELETE FROM journal_notebooks WHERE id=? AND owner_id=?', [req.params.id, currentUserId()])
      return previous.cover_url
    })
    await reclaimAssets(uploadDirectory, [previousCover])
    res.json({ deleted: req.params.id })
  })
  router.patch('/notebooks/:id/reading', async (req, res) => {
    const keys = Object.keys(req.body)
    if (!keys.length || keys.some(key => !['bookmark_page_id', 'last_read_page_id'].includes(key))) fail('阅读位置无效')
    const fields = Object.fromEntries(keys.map(key => [key, req.body[key] === null ? null : uuid(req.body[key])]))
    await transaction(async connection => {
      const pages = await bookPages(connection, req.params.id)
      if (Object.values(fields).some(id => id !== null && !pages.some(page => page.id === id))) fail('页面不属于手帐')
      await connection.execute(`UPDATE journal_notebooks SET ${keys.map(key => key + '=?').join(',')} WHERE id=? AND owner_id=?`, [...Object.values(fields), req.params.id, currentUserId()])
    })
    res.json({ id: req.params.id, ...fields })
  })
  router.post('/notebooks/:id/pages', async (req, res) => {
    const page = await transaction(async (connection) => {
      const pages = await bookPages(connection, req.params.id)
      const index =
        req.body.after_id == null
          ? pages.length
          : pages.findIndex((p) => p.id === uuid(req.body.after_id)) + 1
      if (req.body.after_id != null && index === 0) fail('页面不属于手帐')
      await connection.execute(
        'UPDATE journal_notebook_pages SET sort_order=sort_order+1 WHERE notebook_id=? AND sort_order>=? AND EXISTS (SELECT 1 FROM journal_notebooks b WHERE b.id=journal_notebook_pages.notebook_id AND b.owner_id=?)',
        [req.params.id, index, currentUserId()]
      )
      const p = { id: randomUUID(), notebook_id: req.params.id, sort_order: index }
      await connection.execute(
        'INSERT INTO journal_notebook_pages (id,notebook_id,sort_order) VALUES (?,?,?)',
        [p.id, p.notebook_id, p.sort_order]
      )
      return p
    })
    res.status(201).json(page)
  })
  router.patch('/notebooks/:id/pages', async (req, res) => {
    await transaction(async (connection) => {
      const pages = await bookPages(connection, req.params.id),
        ids = req.body.page_ids
      if (
        !Array.isArray(ids) ||
        ids.length !== pages.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !pages.some((p) => p.id === id))
      )
        fail('页面顺序无效')
      for (const [index, id] of ids.entries())
        await connection.execute('UPDATE journal_notebook_pages SET sort_order=? WHERE id=? AND EXISTS (SELECT 1 FROM journal_notebooks b WHERE b.id=journal_notebook_pages.notebook_id AND b.owner_id=?)', [index, id, currentUserId()])
    })
    res.json({ saved: true })
  })
  router.delete('/notebook-pages/:id', async (req, res) => {
    await transaction(async (connection) => {
      const p = await requirePage(connection, req.params.id)
      const pages = await bookPages(connection, p.notebook_id)
      if (pages.length <= 2) fail('至少保留两页')
      await connection.execute('UPDATE journal_notebooks SET bookmark_page_id=IF(bookmark_page_id=?,NULL,bookmark_page_id),last_read_page_id=IF(last_read_page_id=?,NULL,last_read_page_id) WHERE id=? AND owner_id=?', [req.params.id, req.params.id, p.notebook_id, currentUserId()])
      await connection.execute('DELETE FROM journal_notebook_pages WHERE id=? AND EXISTS (SELECT 1 FROM journal_notebooks b WHERE b.id=journal_notebook_pages.notebook_id AND b.owner_id=?)', [req.params.id, currentUserId()])
      for (const [index, page] of pages.filter((p) => p.id !== req.params.id).entries())
        await connection.execute('UPDATE journal_notebook_pages SET sort_order=? WHERE id=? AND EXISTS (SELECT 1 FROM journal_notebooks b WHERE b.id=journal_notebook_pages.notebook_id AND b.owner_id=?)', [
          index,
          page.id, currentUserId()
        ])
    })
    res.json({ deleted: req.params.id })
  })
  router.post('/notebook-pages/:id/items', async (req, res) => {
    const list = items(req.body.items)
    await transaction(async (connection) => {
      await requirePage(connection, req.params.id)
      for (const item of list) await placeItem(connection, req.params.id, item)
    })
    res.json({ saved: list.length })
  })
  for (const method of ['patch', 'delete'])
    router[method]('/notebook-items', async (req, res) => {
      const list = items(req.body.items, method === 'patch')
      await transaction(async (connection) => {
        for (const i of list) {
          const table = `journal_notebook_${i.kind}_items`
          const [[row]] = await connection.execute(`SELECT i.page_id FROM ${table} i JOIN journal_notebook_pages p ON p.id=i.page_id JOIN journal_notebooks b ON b.id=p.notebook_id WHERE i.id=? AND b.owner_id=? FOR UPDATE`, [
            i.id, currentUserId()
          ])
          if (!row) fail('页面内容已不存在', 404)
          await requirePage(connection, row.page_id)
          const [[source]] = await connection.execute(`SELECT id FROM ${tables[i.kind]} WHERE id=? AND ${i.kind === 'photo' ? 'EXISTS (SELECT 1 FROM journal_entries e WHERE e.id=journal_photos.entry_id AND e.owner_id=?)' : 'owner_id=?'} FOR UPDATE`, [i.id, currentUserId()])
          if (!source) fail('Resource unavailable', 404)
          if (method === 'patch')
            await connection.execute(`UPDATE ${table} SET x=?,y=?,rotation=? WHERE id=? AND EXISTS (SELECT 1 FROM journal_notebook_pages p JOIN journal_notebooks b ON b.id=p.notebook_id WHERE p.id=${table}.page_id AND b.owner_id=?)`, [
              i.x,
              i.y,
              i.rotation ?? 0,
              i.id, currentUserId()
            ])
          else await connection.execute(`DELETE FROM ${table} WHERE id=? AND EXISTS (SELECT 1 FROM journal_notebook_pages p JOIN journal_notebooks b ON b.id=p.notebook_id WHERE p.id=${table}.page_id AND b.owner_id=?)`, [i.id, currentUserId()])
        }
      })
      res.json({ saved: list.length })
    })
}
