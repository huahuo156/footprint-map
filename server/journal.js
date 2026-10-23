import { Router } from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pool } from './db.js'
import { notebookRoutes, readNotebooks, transaction, requirePage, placeItem } from './notebooks.js'
import { MARK_COLORS, MARK_SIZES, STICKERS } from '../shared/journal-marks.js'
import { legacyComponents, patchComponents } from '../shared/journal-components.js'
import { expandCanvasGroups } from '../shared/journal-groups.js'

const colors = ['sage', 'sand', 'sky', 'rose', 'lavender']
const filters = ['original', 'film', 'mono']
const componentTypes = ['date', 'place', 'trip', 'description', 'mood', 'title']
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const extensions = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }
const invalid = message => Object.assign(new Error(message), { status: 400 })
const missing = message => Object.assign(new Error(message), { status: 404 })
function text(value, max, required = false) {
  if (value == null && !required) return null
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid('内容为空或超过长度限制')
  return value.trim() || null
}
function id(value) {
  if (typeof value !== 'string' || !/^[a-f\d-]{36}$/i.test(value)) throw invalid('记录编号无效')
  return value
}
function number(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid('数值超出范围')
  return value
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < '1900') throw invalid('请选择有效日期')
  const parsed = new Date(value + 'T12:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalid('日期不存在')
  return value
}
function components(value) {
  if (value == null) return null
  if (!Array.isArray(value) || value.length > componentTypes.length) throw invalid('添加的内容组件无效')
  const used = new Set()
  return value.map(component => {
    if (!component || !componentTypes.includes(component.type) || used.has(component.type)) throw invalid('内容组件重复或不支持')
    used.add(component.type)
    let content = component.value
    if (component.type === 'date') content = content ? date(content) : null
    if (component.type === 'trip') content = content ? id(content) : null
    if (component.type === 'description') content = text(content, 10000)
    if (component.type === 'title') content = text(content, 160)
    if (component.type === 'mood' && content != null && content !== '' && !['平静', '开心', '惊喜'].includes(content)) throw invalid('心情无效')
    if (component.type === 'place') {
      if (!content || typeof content !== 'object' || Array.isArray(content)) throw invalid('地点组件无效')
      content = { name: text(content.name, 255), landmark_id: content.landmark_id == null ? null : number(content.landmark_id, 1, 2147483647), lat: content.lat == null ? null : number(content.lat, -90, 90), lng: content.lng == null ? null : number(content.lng, -180, 180), spot_key: text(content.spot_key, 40) }
      if ((content.lat == null) !== (content.lng == null) || (content.landmark_id != null && !Number.isInteger(content.landmark_id))) throw invalid('地点坐标或编号无效')
    }
    return { type: component.type, value: content || null }
  })
}
async function journal() {
  const [trips] = await pool.query('SELECT id,name,region,color,canvas_x,canvas_y FROM journal_trips ORDER BY created_at,id')
  const [entries] = await pool.query("SELECT *, DATE_FORMAT(entry_date,'%Y-%m-%d') AS entry_date, DATE_FORMAT(captured_on,'%Y-%m-%d') AS captured_on FROM journal_entries ORDER BY entry_date DESC,created_at DESC,id")
  const [photos] = await pool.query('SELECT * FROM journal_photos ORDER BY sort_order,id')
  const grouped = new Map()
  for (const photo of photos) {
    if (!grouped.has(photo.entry_id)) grouped.set(photo.entry_id, [])
    grouped.get(photo.entry_id).push(photo)
  }
  const [marks] = await pool.query("SELECT *, DATE_FORMAT(captured_on,'%Y-%m-%d') AS captured_on FROM journal_marks ORDER BY created_at,id")
  const [canvasGroups] = await pool.query('SELECT * FROM journal_canvas_groups ORDER BY created_at,id')
  const [members] = await pool.query('SELECT photo_id,group_id FROM journal_canvas_group_photos ORDER BY photo_id')
  const [children] = await pool.query('SELECT child_id,parent_id FROM journal_canvas_group_children')
  const parents = new Map(children.map(child => [child.child_id, child.parent_id]))
  return { ...await readNotebooks(), trips, entries: entries.map(entry => ({ ...entry, photos: grouped.get(entry.id) || [] })), marks, canvas_groups: expandCanvasGroups(canvasGroups.map(group => ({ ...group, parent_id: parents.get(group.id), photo_ids: members.filter(member => member.group_id === group.id).map(member => member.photo_id) }))) }
}
async function imageType(file) {
  const handle = await open(file.path, 'r')
  try {
    const buffer = Buffer.alloc(16)
    await handle.read(buffer, 0, 16, 0)
    if (buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg'
    if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
    return null
  } finally { await handle.close() }
}

async function changeCanvasGroups(change) {
  const connection = await pool.getConnection()
  let locked = false
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('shitu-canvas-groups', 10) AS acquired")
    if (!lock.acquired) throw invalid('色块正在更新，请稍后重试')
    locked = true
    await connection.beginTransaction()
    const [groups] = await connection.query('SELECT * FROM journal_canvas_groups ORDER BY id FOR UPDATE')
    const [members] = await connection.query('SELECT photo_id,group_id FROM journal_canvas_group_photos FOR UPDATE')
    const [children] = await connection.query('SELECT child_id,parent_id FROM journal_canvas_group_children FOR UPDATE')
    const parents = new Map(children.map(child => [child.child_id, child.parent_id]))
    const expanded = expandCanvasGroups(groups.map(group => ({ ...group, parent_id: parents.get(group.id), photo_ids: members.filter(member => member.group_id === group.id).map(member => member.photo_id) })))
    const result = await change(connection, expanded)
    await connection.commit()
    return result
  } catch (error) { await connection.rollback(); throw error }
  finally {
    if (locked) await connection.query("SELECT RELEASE_LOCK('shitu-canvas-groups')")
    connection.release()
  }
}

export function createJournalRouter(uploadDirectory) {
  const router = Router()
  notebookRoutes(router, uploadDirectory)
  const upload = multer({
    storage: multer.diskStorage({ destination: uploadDirectory, filename: (_req, file, cb) => cb(null, randomUUID() + extensions[file.mimetype]) }),
    limits: { fileSize: 10 * 1024 * 1024, files: 20, fieldSize: 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(extensions[file.mimetype] ? null : invalid('请选择 JPG、PNG 或 WebP 照片'), !!extensions[file.mimetype]),
  })
  async function removeUnused(url) {
    if (!/^\/uploads\/[\w-]+\.(jpg|png|webp)$/.test(url)) return
    const [[row]] = await pool.query(`SELECT (SELECT COUNT(*) FROM journal_photos WHERE url=?) + (SELECT COUNT(*) FROM checkins WHERE image_url=?) + (SELECT COUNT(*) FROM guides WHERE cover_image_url=?) + (SELECT COUNT(*) FROM journal_notebooks WHERE cover_url=?) AS total`, [url, url, url, url])
    if (!Number(row.total)) await unlink(path.join(uploadDirectory, path.basename(url))).catch(() => {})
  }
  router.get('/', async (_req, res) => res.json(await journal()))
  router.post('/groups', async (req, res) => {
    const name = text(req.body.name, 120, true), color = req.body.color || 'sage', positions = req.body.positions
    if (!colors.includes(color) || !Array.isArray(positions) || !positions.length || positions.length > 500) throw invalid('请选择照片和有效的色块样式')
    const used = new Set()
    for (const position of positions) {
      if (!position || used.has(position.id)) throw invalid('照片重复或无效')
      id(position.id); used.add(position.id)
      number(position.x, -1e7, 1e7); number(position.y, -1e7, 1e7); number(position.rotation ?? 0, -20, 20)
    }
    const groupId = randomUUID()
    const saved = await changeCanvasGroups(async (connection, groups) => {
      const roots = groups.filter(group => !group.parent_id && group.photo_ids.some(photoId => used.has(photoId)))
      if (roots.some(group => group.photo_ids.some(photoId => !used.has(photoId)))) throw invalid('请选中完整色块后再分组，已有分组可能发生变化，请刷新后重试')
      const grouped = new Set(roots.flatMap(group => group.photo_ids))
      for (const position of [...positions].sort((a, b) => a.id.localeCompare(b.id))) {
        const [[photo]] = await connection.execute('SELECT id FROM journal_photos WHERE id=? FOR UPDATE', [position.id])
        if (!photo) throw missing('有照片已被删除，请重新选择')
      }
      await connection.execute('INSERT INTO journal_canvas_groups (id,name,color) VALUES (?,?,?)', [groupId, name, color])
      for (const root of roots) await connection.execute('INSERT INTO journal_canvas_group_children (child_id,parent_id) VALUES (?,?)', [root.id, groupId])
      for (const position of positions) {
        if (!grouped.has(position.id)) await connection.execute('INSERT INTO journal_canvas_group_photos (photo_id,group_id) VALUES (?,?)', [position.id, groupId])
        await connection.execute('UPDATE journal_photos SET canvas_x=?,canvas_y=?,rotation=?,canvas_absolute=TRUE WHERE id=?', [position.x, position.y, position.rotation ?? 0, position.id])
      }
      return { id: groupId, name, color, parent_id: null, child_group_ids: roots.map(group => group.id), direct_photo_ids: positions.filter(position => !grouped.has(position.id)).map(position => position.id), photo_ids: positions.map(position => position.id) }
    })
    res.status(201).json(saved)
  })
  router.patch('/groups/:id', async (req, res) => {
    const groupId = id(req.params.id), changes = {}
    if (Object.hasOwn(req.body, 'name')) changes.name = text(req.body.name, 120, true)
    if (Object.hasOwn(req.body, 'color')) {
      if (!colors.includes(req.body.color)) throw invalid('色块颜色无效')
      changes.color = req.body.color
    }
    if (Object.hasOwn(req.body, 'collapsed')) {
      if (typeof req.body.collapsed !== 'boolean') throw invalid('色块折叠状态无效')
      changes.collapsed = req.body.collapsed
    }
    if (!Object.keys(changes).length) throw invalid('请选择需要修改的色块内容')
    await changeCanvasGroups(async (connection, groups) => {
      const group = groups.find(item => item.id === groupId)
      if (!group) throw missing('这个色块已不存在')
      const positions = req.body.positions
      if (positions != null) {
        if (!Array.isArray(positions) || positions.length !== group.photo_ids.length || new Set(positions.map(p => p?.id)).size !== positions.length) throw invalid('展开后的照片位置不完整')
        for (const position of positions) {
          if (!position || !group.photo_ids.includes(id(position.id))) throw invalid('照片不属于这个色块')
          number(position.x, -1e7, 1e7); number(position.y, -1e7, 1e7); number(position.rotation ?? 0, -20, 20)
        }
        for (const position of positions) await connection.execute('UPDATE journal_photos SET canvas_x=?,canvas_y=?,rotation=?,canvas_absolute=TRUE WHERE id=?', [position.x, position.y, position.rotation ?? 0, position.id])
      }
      await connection.execute(`UPDATE journal_canvas_groups SET ${Object.keys(changes).map(key => `${key}=?`).join(',')} WHERE id=?`, [...Object.values(changes), groupId])
    })
    res.json({ id: groupId, ...changes })
  })
  router.delete('/groups/:id', async (req, res) => {
    const groupId = id(req.params.id)
    await changeCanvasGroups(async (connection, groups) => {
      const group = groups.find(group => group.id === groupId)
      if (!group) throw missing('这个色块已不存在')
      if (group.parent_id) {
        await connection.execute('UPDATE journal_canvas_group_children SET parent_id=? WHERE parent_id=?', [group.parent_id, groupId])
        await connection.execute('UPDATE journal_canvas_group_photos SET group_id=? WHERE group_id=?', [group.parent_id, groupId])
      }
      await connection.execute('DELETE FROM journal_canvas_groups WHERE id=?', [groupId])
    })
    res.json({ deleted: groupId })
  })
  router.patch('/photos/components', async (req, res) => {
    const ids = req.body.photo_ids, updates = components(req.body.components), positions = req.body.positions
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length || !updates?.length) throw invalid('请选择照片和需要同步的内容')
    ids.forEach(id)
    const layout = new Map()
    if (positions != null) {
      if (!Array.isArray(positions) || positions.length !== ids.length) throw invalid('照片位置无效')
      for (const position of positions) {
        if (!position || !ids.includes(position.id) || layout.has(position.id)) throw invalid('照片位置无效')
        layout.set(position.id, { x: number(position.x, -1e7, 1e7), y: number(position.y, -1e7, 1e7), rotation: number(position.rotation ?? 0, -20, 20) })
      }
    }
    const connection = await pool.getConnection(), placeholders = ids.map(() => '?').join(',')
    try {
      await connection.beginTransaction()
      const [parents] = await connection.query(`SELECT DISTINCT entry_id FROM journal_photos WHERE id IN (${placeholders})`, ids)
      if (parents.length) await connection.query(`SELECT id FROM journal_entries WHERE id IN (${parents.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, parents.map(row => row.entry_id))
      const [photos] = await connection.query(`SELECT p.*,e.components AS entry_components,e.trip_id,e.title,e.caption,e.place_name,e.landmark_id,e.lat,e.lng,e.spot_key,e.mood,DATE_FORMAT(e.entry_date,'%Y-%m-%d') AS entry_date FROM journal_photos p JOIN journal_entries e ON e.id=p.entry_id WHERE p.id IN (${placeholders}) ORDER BY p.id FOR UPDATE`, ids)
      if (photos.length !== ids.length) throw missing('有照片已被删除，请刷新后重新选择')
      for (const part of updates.filter(part => part.type === 'trip' && part.value)) {
        const [[trip]] = await connection.execute('SELECT id FROM journal_trips WHERE id=?', [part.value])
        if (!trip) throw invalid('这段旅程已不存在')
      }
      for (const photo of photos) {
        const original = photo.components ?? photo.entry_components ?? legacyComponents(photo)
        await connection.execute('UPDATE journal_photos SET components=? WHERE id=?', [JSON.stringify(patchComponents(original, updates)), photo.id])
        const position = layout.get(photo.id)
        if (position) await connection.execute('UPDATE journal_photos SET canvas_x=?,canvas_y=?,rotation=?,canvas_absolute=TRUE WHERE id=?', [position.x, position.y, position.rotation, photo.id])
      }
      await connection.commit()
      res.json({ saved: photos.length })
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  })
  async function saveMark(req, res) {
    const data = req.body, kind = data.kind, color = data.color || 'ink', size = data.size || 'medium'
    if (!['text', 'sticker'].includes(kind) || !MARK_COLORS.includes(color) || !MARK_SIZES.includes(size)) throw invalid('标注样式无效')
    const content = kind === 'text' ? text(data.text, 500, true) : null
    const sticker = kind === 'sticker' ? data.sticker : null
    if (kind === 'sticker' && !STICKERS.includes(sticker)) throw invalid('请选择支持的贴纸')
    const rotation = number(data.rotation ?? 0, -20, 20)
    const markId = req.params.id ? id(req.params.id) : randomUUID()
    if (req.params.id) {
      const [result] = await pool.execute('UPDATE journal_marks SET kind=?,text=?,sticker=?,color=?,size=?,rotation=? WHERE id=?', [kind, content, sticker, color, size, rotation, markId])
      if (!result.affectedRows) throw missing('这张标注已经不存在了')
    } else {
      const x = number(data.canvas_x ?? 0, -1e7, 1e7), y = number(data.canvas_y ?? 0, -1e7, 1e7)
      await transaction(async connection => {
        if (data.notebook_page_id != null) await requirePage(connection, data.notebook_page_id)
        await connection.execute('INSERT INTO journal_marks (id,kind,text,sticker,color,size,canvas_x,canvas_y,rotation,captured_on) VALUES (?,?,?,?,?,?,?,?,?,?)', [markId, kind, content, sticker, color, size, x, y, rotation, today()])
        if (data.notebook_page_id != null) await placeItem(connection, data.notebook_page_id, {kind:'mark',id:markId,x:data.canvas_x??600,y:data.canvas_y??800,rotation})
      })
    }
    res.status(req.params.id ? 200 : 201).json({ id: markId })
  }
  router.post('/marks', saveMark)
  router.put('/marks/:id', saveMark)
  router.delete('/marks/:id', async (req, res) => {
    const markId = id(req.params.id), [result] = await pool.execute('DELETE FROM journal_marks WHERE id=?', [markId])
    if (!result.affectedRows) throw missing('这张标注已经不存在了')
    res.json({ deleted: markId })
  })
  router.post('/trips', async (req, res) => {
    const name = text(req.body.name, 120, true), region = text(req.body.region, 120)
    const color = req.body.color || 'sage'
    if (!colors.includes(color)) throw invalid('请选择有效的旅程颜色')
    const tripId = randomUUID()
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM journal_trips')
    await pool.execute('INSERT INTO journal_trips (id,name,region,color,canvas_x,canvas_y) VALUES (?,?,?,?,?,?)', [tripId, name, region, color, total % 3 * 800, Math.floor(total / 3) * 900 + (total % 2 ? -90 : 30)])
    const [[trip]] = await pool.execute('SELECT * FROM journal_trips WHERE id=?', [tripId])
    res.status(201).json(trip)
  })
  router.patch('/trips/:id', async (req, res) => {
    const tripId = id(req.params.id), name = text(req.body.name, 120, true), region = text(req.body.region, 120), color = req.body.color || 'sage'
    if (!colors.includes(color)) throw invalid('请选择有效的旅程颜色')
    const [result] = await pool.execute('UPDATE journal_trips SET name=?,region=?,color=? WHERE id=?', [name, region, color, tripId])
    if (!result.affectedRows) throw missing('这段旅程不存在')
    res.json({ id: tripId, name, region, color })
  })
  async function saveEntry(req, res) {
    const files = req.files || [], createdFiles = files.map(file => file.path)
    let connection, committed = false, removed = []
    try {
      let data
      try { data = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body } catch { throw invalid('手帐内容无法读取') }
      if (!data || typeof data !== 'object') throw invalid('手帐内容无效')
      const entryId = req.params.id ? id(req.params.id) : randomUUID(), tripId = data.trip_id ? id(data.trip_id) : null
      const entryDate = date(data.entry_date || today()), title = text(data.title, 160), caption = text(data.caption, 10000), place = text(data.place_name, 255)
      const entryComponents = components(data.components), photoComponents = []
      const mood = data.mood || null, spot = text(data.spot_key, 40)
      if (mood && !['平静', '开心', '惊喜'].includes(mood)) throw invalid('请选择有效的心情')
      let lat = null, lng = null
      if (data.lat != null || data.lng != null) { lat = number(data.lat, -90, 90); lng = number(data.lng, -180, 180) }
      const landmark = data.landmark_id == null ? null : number(data.landmark_id, 1, 2147483647)
      if (landmark != null && !Number.isInteger(landmark)) throw invalid('景点编号无效')
      if (!Array.isArray(data.photos) || data.photos.length > 20) throw invalid('每一页最多放 20 张照片')
      if (!data.photos.length && !title && !caption && !entryComponents?.some(component => component.type === 'place' ? component.value?.name || component.value?.lat != null : component.value)) throw invalid('放一张照片，或添加一点想留下的内容')
      for (const photo of data.photos) {
        if (!photo || typeof photo !== 'object' || Array.isArray(photo)) throw invalid('照片信息无效')
        photoComponents.push(components(photo.components))
      }
      const detectedTypes = await Promise.all(files.map(imageType))
      const invalidFiles = detectedTypes.flatMap((type, index) => type ? [] : [{ index, reason: '未识别为 JPG、PNG 或 WebP 照片，请转换格式或检查文件是否完整。' }])
      if (invalidFiles.length) throw Object.assign(invalid('有文件未通过照片校验，请查看具体文件后重新选择。'), { code: 'INVALID_IMAGES', invalidFiles })
      // Use the actual image format: downloaded images may have a misleading extension/MIME type.
      for (const [index, file] of files.entries()) {
        const extension = extensions[detectedTypes[index]]
        if (path.extname(file.filename) === extension) continue
        const filename = path.parse(file.filename).name + extension, destination = path.join(uploadDirectory, filename)
        await rename(file.path, destination)
        file.path = destination; file.filename = filename; createdFiles[index] = destination
      }
      connection = await pool.getConnection()
      await connection.beginTransaction()
      if (data.notebook_page_id != null) await requirePage(connection, data.notebook_page_id)
      const tripIds = new Set([tripId, ...[entryComponents, ...photoComponents].flatMap(list => (list || []).filter(component => component.type === 'trip').map(component => component.value))].filter(Boolean))
      for (const selectedTrip of tripIds) {
        const [[trip]] = await connection.execute('SELECT id FROM journal_trips WHERE id=?', [selectedTrip])
        if (!trip) throw invalid('这段旅程已不存在，可以移除旅程组件后留下照片')
      }
      let existing = []
      if (req.params.id) {
        const [[entry]] = await connection.execute('SELECT id FROM journal_entries WHERE id=? FOR UPDATE', [entryId])
        if (!entry) throw missing('这一页已经不存在了')
        ;[existing] = await connection.execute('SELECT * FROM journal_photos WHERE entry_id=?', [entryId])
        await connection.execute('UPDATE journal_entries SET trip_id=?,entry_date=?,title=?,caption=?,place_name=?,landmark_id=?,lat=?,lng=?,spot_key=?,mood=?,components=? WHERE id=?', [tripId, entryDate, title, caption, place, landmark, lat, lng, spot, mood, entryComponents == null ? null : JSON.stringify(entryComponents), entryId])
      } else {
        await connection.execute('INSERT INTO journal_entries (id,trip_id,entry_date,captured_on,title,caption,place_name,landmark_id,lat,lng,spot_key,mood,components) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [entryId, tripId, entryDate, today(), title, caption, place, landmark, lat, lng, spot, mood, entryComponents == null ? null : JSON.stringify(entryComponents)])
      }
      const usedIds = new Set(), usedUploads = new Set()
      for (const [order, photo] of data.photos.entries()) {
        if (!photo || typeof photo !== 'object' || Array.isArray(photo)) throw invalid('照片信息无效')
        const crop = number(photo.crop_x ?? 50, 0, 100), filter = photo.image_filter || 'original'
        if (!filters.includes(filter)) throw invalid('照片滤镜无效')
        if (photo.id) {
          const old = existing.find(item => item.id === photo.id)
          if (!old || usedIds.has(photo.id)) throw invalid('照片不属于这一页或重复出现')
          usedIds.add(photo.id)
          await connection.execute('UPDATE journal_photos SET crop_x=?,image_filter=?,sort_order=?,components=? WHERE id=?', [Math.round(crop), filter, order, Object.hasOwn(photo, 'components') ? (photoComponents[order] == null ? null : JSON.stringify(photoComponents[order])) : (old.components == null ? null : JSON.stringify(old.components)), old.id])
        } else {
          const index = photo.upload_index
          if (!Number.isInteger(index) || !files[index] || usedUploads.has(index)) throw invalid('照片上传信息不完整')
          usedUploads.add(index)
          const pinned = photo.canvas_x != null || photo.canvas_y != null
          const x = pinned ? number(photo.canvas_x, -1e7, 1e7) : null, y = pinned ? number(photo.canvas_y, -1e7, 1e7) : null
          const photoId = randomUUID()
          await connection.execute('INSERT INTO journal_photos (id,entry_id,url,crop_x,image_filter,rotation,sort_order,components,canvas_x,canvas_y,canvas_absolute) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [photoId, entryId, '/uploads/' + files[index].filename, Math.round(crop), filter, order % 2 ? 3 : -3, order, photoComponents[order] == null ? null : JSON.stringify(photoComponents[order]), x, y, pinned])
          if (data.notebook_page_id != null) await placeItem(connection, data.notebook_page_id, {kind:'photo',id:photoId,x:x??600,y:y??800,rotation:order % 2 ? 3 : -3})
        }
      }
      if (data.photos.length) await connection.execute('DELETE FROM journal_notebook_entry_items WHERE id=?', [entryId])
      else if (data.notebook_page_id != null && !req.params.id) await placeItem(connection, data.notebook_page_id, {kind:'entry',id:entryId,x:data.canvas_x??600,y:data.canvas_y??800,rotation:0})
      if (usedUploads.size !== files.length) throw invalid('上传的照片没有全部加入这一页')
      for (const photo of existing.filter(item => !usedIds.has(item.id))) {
        await connection.execute('DELETE FROM journal_photos WHERE id=?', [photo.id])
        removed.push(photo.url)
      }
      await connection.commit()
      committed = true
      res.status(req.params.id ? 200 : 201).json({ id: entryId })
    } catch (error) {
      if (connection && !committed) await connection.rollback()
      if (!committed) await Promise.all(createdFiles.map(file => unlink(file).catch(() => {})))
      throw error
    } finally {
      connection?.release()
      if (committed) await Promise.all(removed.map(url => removeUnused(url).catch(console.error)))
    }
  }
  router.post('/entries', upload.array('images', 20), saveEntry)
  router.put('/entries/:id', upload.array('images', 20), saveEntry)
  router.delete('/items', async (req, res) => {
    const items = req.body?.items, groups = { photo: [], entry: [], mark: [] }, used = new Set()
    if (!Array.isArray(items) || !items.length || items.length > 500) throw invalid('请选择需要删除的内容')
    for (const item of items) {
      if (!item || !Object.hasOwn(groups, item.kind)) throw invalid('画布内容类型无效')
      id(item.id)
      const key = item.kind + ':' + item.id
      if (used.has(key)) throw invalid('删除的内容不能重复')
      used.add(key); groups[item.kind].push(item.id)
    }
    const connection = await pool.getConnection()
    let urls = []
    const placeholders = ids => ids.map(() => '?').join(',')
    try {
      await connection.beginTransaction()
      const [parents] = groups.photo.length ? await connection.query(`SELECT DISTINCT entry_id FROM journal_photos WHERE id IN (${placeholders(groups.photo)})`, groups.photo) : [[]]
      const parentIds = [...new Set([...groups.entry, ...parents.map(row => row.entry_id)])]
      const [lockedParents] = parentIds.length ? await connection.query(`SELECT id FROM journal_entries WHERE id IN (${placeholders(parentIds)}) ORDER BY id FOR UPDATE`, parentIds) : [[]]
      if (groups.entry.some(entryId => !lockedParents.some(row => row.id === entryId))) throw missing('有内容已被删除，请刷新后重新选择')
      const [photos] = groups.photo.length ? await connection.query(`SELECT id,url FROM journal_photos WHERE id IN (${placeholders(groups.photo)}) ORDER BY id FOR UPDATE`, groups.photo) : [[]]
      const [marks] = groups.mark.length ? await connection.query(`SELECT id FROM journal_marks WHERE id IN (${placeholders(groups.mark)}) ORDER BY id FOR UPDATE`, groups.mark) : [[]]
      if (photos.length !== groups.photo.length || marks.length !== groups.mark.length) throw missing('有内容已被删除，请刷新后重新选择')
      if (groups.entry.length) {
        const [attached] = await connection.query(`SELECT id FROM journal_photos WHERE entry_id IN (${placeholders(groups.entry)}) FOR UPDATE`, groups.entry)
        if (attached.length) throw invalid('这条记录含有照片，请选择具体照片删除')
      }
      if (groups.photo.length) await connection.query(`DELETE FROM journal_photos WHERE id IN (${placeholders(groups.photo)})`, groups.photo)
      if (groups.mark.length) await connection.query(`DELETE FROM journal_marks WHERE id IN (${placeholders(groups.mark)})`, groups.mark)
      if (parentIds.length) await connection.query(`DELETE FROM journal_entries WHERE id IN (${placeholders(parentIds)}) AND NOT EXISTS (SELECT 1 FROM journal_photos WHERE entry_id=journal_entries.id)`, parentIds)
      urls = [...new Set(photos.map(photo => photo.url))]
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await Promise.all(urls.map(url => removeUnused(url).catch(console.error)))
    res.json({ deleted: items.length })
  })
  router.delete('/photos', async (req, res) => {
    const ids = req.body?.photo_ids
    if (!Array.isArray(ids) || !ids.length || ids.length > 500 || new Set(ids).size !== ids.length) throw invalid('请选择需要删除的照片')
    ids.forEach(id)
    const connection = await pool.getConnection(), placeholders = ids.map(() => '?').join(',')
    let urls = []
    try {
      await connection.beginTransaction()
      const [parents] = await connection.query(`SELECT DISTINCT entry_id FROM journal_photos WHERE id IN (${placeholders})`, ids)
      if (parents.length) await connection.query(`SELECT id FROM journal_entries WHERE id IN (${parents.map(() => '?').join(',')}) ORDER BY id FOR UPDATE`, parents.map(row => row.entry_id))
      const [photos] = await connection.query(`SELECT id,url FROM journal_photos WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`, ids)
      if (photos.length !== ids.length) throw missing('有照片已被删除，请刷新后重新选择')
      await connection.query(`DELETE FROM journal_photos WHERE id IN (${placeholders})`, ids)
      await connection.query(`DELETE FROM journal_entries WHERE id IN (${parents.map(() => '?').join(',')}) AND NOT EXISTS (SELECT 1 FROM journal_photos WHERE entry_id=journal_entries.id)`, parents.map(row => row.entry_id))
      urls = [...new Set(photos.map(photo => photo.url))]
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await Promise.all(urls.map(url => removeUnused(url).catch(console.error)))
    res.json({ deleted: ids.length })
  })
  router.delete('/photos/:id', async (req, res) => {
    const photoId = id(req.params.id), connection = await pool.getConnection()
    let url
    try {
      await connection.beginTransaction()
      const [[photo]] = await connection.execute('SELECT entry_id,url FROM journal_photos WHERE id=?', [photoId])
      if (!photo) throw missing('这张照片已经不存在了')
      await connection.execute('SELECT id FROM journal_entries WHERE id=? FOR UPDATE', [photo.entry_id])
      await connection.execute('DELETE FROM journal_photos WHERE id=?', [photoId])
      const [[{ total }]] = await connection.execute('SELECT COUNT(*) AS total FROM journal_photos WHERE entry_id=?', [photo.entry_id])
      if (!total) await connection.execute('DELETE FROM journal_entries WHERE id=?', [photo.entry_id])
      url = photo.url
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await removeUnused(url).catch(console.error)
    res.json({ deleted: photoId })
  })
  router.delete('/entries/:id', async (req, res) => {
    const entryId = id(req.params.id)
    const [photos] = await pool.execute('SELECT url FROM journal_photos WHERE entry_id=?', [entryId])
    const [result] = await pool.execute('DELETE FROM journal_entries WHERE id=?', [entryId])
    if (!result.affectedRows) throw missing('这一页已经不存在了')
    await Promise.all(photos.map(photo => removeUnused(photo.url).catch(console.error)))
    res.json({ deleted: entryId })
  })
  router.patch('/layout', async (req, res) => {
    const items = req.body.items
    if (!Array.isArray(items) || !items.length || items.length > 500) throw invalid('画布位置无效')
    for (const item of items) { id(item.id); if (!['photo', 'entry', 'mark'].includes(item.kind)) throw invalid('画布元素类型无效'); number(item.x, -1e7, 1e7); number(item.y, -1e7, 1e7); number(item.rotation ?? 0, -20, 20) }
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      for (const item of items) {
        const table = item.kind === 'mark' ? 'journal_marks' : item.kind === 'photo' ? 'journal_photos' : 'journal_entries'
        const [[row]] = await connection.execute(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`, [item.id])
        if (!row) throw missing('照片或手帐已经不存在了')
        await connection.execute(`UPDATE ${table} SET canvas_x=?,canvas_y=?,rotation=?${item.kind === 'photo' ? ',canvas_absolute=TRUE' : ''} WHERE id=?`, [item.x, item.y, item.rotation ?? 0, item.id])
      }
      await connection.commit()
      res.json({ saved: items.length })
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  })
  return router
}
