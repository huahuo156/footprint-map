// 手帐备份：GET /backup 打包成 ZIP（照片 + backup.json），POST /restore 合并还原。
// 还原为合并语义：生成新编号导入，现有内容一律保留、绝不删除。
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { open, readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { pool } from './db.js'
import { components as parseComponents } from './journal.js'
import { MARK_COLORS, MARK_SIZES, STICKERS } from '../shared/journal-marks.js'
import { readZip, zipChunks } from './zip.js'
import { expandCanvasGroups } from '../shared/journal-groups.js'

const BACKUP_FORMAT = 'shitu-journal-backup'
const colors = ['sage', 'sand', 'sky', 'rose', 'lavender']
const filters = ['original', 'film', 'mono']
const moods = ['平静', '开心', '惊喜']
const uploadPattern = /^\/uploads\/([\w-]+\.(jpg|png|webp))$/
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
const invalid = message => Object.assign(new Error(message), { status: 400 })
function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f\d-]{36}$/i.test(value)) throw invalid('备份里的编号无效')
  return value
}
function text(value, max, required = false) {
  if (value == null && !required) return null
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw invalid('备份里的文字内容无效')
  return value.trim() || null
}
function number(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw invalid('备份里的数值超出范围')
  return value
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) < '1900') throw invalid('备份里的日期无效')
  const parsed = new Date(value + 'T12:00:00Z')
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw invalid('备份里的日期无效')
  return value
}
function timestamp(value) {
  if (value == null) return new Date()
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw invalid('备份里的创建时间无效')
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) throw invalid('备份里的创建时间无效')
  return parsed
}
const rotation = value => number(value ?? 0, -20, 20)
const coordinate = value => value == null ? null : number(value, -1e7, 1e7)
// 引用其他表的编号必须能对应上，否则插入会因外键失败，这里提前给出明确报错。
const mapped = (map, value, label) => {
  const old = uuid(value)
  if (!map.has(old)) throw invalid(`备份的${label}引用了不存在的内容，这份备份不完整`)
  return map.get(old)
}
function remap(rows, label) {
  const map = new Map()
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid(`备份的${label}无法读取`)
    const old = uuid(row.id)
    if (map.has(old)) throw invalid(`备份的${label}有重复编号`)
    map.set(old, randomUUID())
  }
  return map
}
async function bulkInsert(connection, table, columns, rows) {
  for (let i = 0; i < rows.length; i += 50) {
    const slice = rows.slice(i, i + 50)
    await connection.query(`INSERT INTO ${table} (${columns.join()}) VALUES ${slice.map(() => `(${columns.map(() => '?').join()})`).join()}`, slice.flat())
  }
}

export function backupRoutes(router, uploadDirectory) {
  router.get('/backup', async (_req, res) => {
    const connection = await pool.getConnection()
    let snapshot
    try {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
      await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
      const query = sql => connection.query(sql).then(([rows]) => rows)
      snapshot = await Promise.all([
        query('SELECT * FROM journal_trips ORDER BY created_at,id'),
        query("SELECT *, DATE_FORMAT(entry_date,'%Y-%m-%d') AS entry_date, DATE_FORMAT(captured_on,'%Y-%m-%d') AS captured_on FROM journal_entries ORDER BY created_at,id"),
        query('SELECT * FROM journal_photos ORDER BY entry_id,sort_order,id'),
        query("SELECT *, DATE_FORMAT(captured_on,'%Y-%m-%d') AS captured_on FROM journal_marks ORDER BY created_at,id"),
        query('SELECT * FROM journal_canvas_groups ORDER BY created_at,id'),
        query('SELECT photo_id,group_id FROM journal_canvas_group_photos ORDER BY photo_id'),
        query('SELECT child_id,parent_id FROM journal_canvas_group_children ORDER BY child_id'),
        query('SELECT * FROM journal_notebooks ORDER BY created_at,id'),
        query('SELECT * FROM journal_notebook_pages ORDER BY notebook_id,sort_order,id'),
        query('SELECT * FROM journal_notebook_photo_items ORDER BY id'),
        query('SELECT * FROM journal_notebook_mark_items ORDER BY id'),
        query('SELECT * FROM journal_notebook_entry_items ORDER BY id'),
      ])
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error }
    finally { connection.release() }
    const [trips, entries, photos, marks, canvas_groups, canvas_group_photos, canvas_group_children, notebooks, notebook_pages, notebook_photo_items, notebook_mark_items, notebook_entry_items] = snapshot
    const referenced = new Set()
    for (const photo of photos) {
      const match = uploadPattern.exec(photo.url || '')
      if (match) referenced.add(match[1])
    }
    for (const book of notebooks) {
      const match = uploadPattern.exec(book.cover_url || '')
      if (match) referenced.add(match[1])
    }
    const photoEntries = [], missing = []
    let totalBytes = 0
    for (const basename of referenced) {
      const target = path.join(uploadDirectory, basename)
      const info = await stat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
      if (info?.isFile()) { photoEntries.push({ name: 'photos/' + basename, path: target }); totalBytes += info.size }
      else missing.push('/uploads/' + basename)
    }
    const manifest = {
      format: BACKUP_FORMAT,
      version: 1,
      exported_at: new Date().toISOString(),
      missing_files: missing,
      data: { trips, entries, photos, marks, canvas_groups, canvas_group_photos, canvas_group_children, notebooks, notebook_pages, notebook_photo_items, notebook_mark_items, notebook_entry_items },
    }
    const entries2 = [{ name: 'backup.json', data: Buffer.from(JSON.stringify(manifest)) }, ...photoEntries]
    // A successful export must fit the same limits as restore, including ZIP headers.
    const zipOverhead = 22 + entries2.reduce((size, entry) => size + 76 + Buffer.byteLength(entry.name) * 2, 0)
    if (totalBytes + entries2[0].data.length + zipOverhead > 1024 * 1024 * 1024) throw Object.assign(new Error('备份超过 1GB，无法导出为可还原的 ZIP。请使用数据库卷和 uploads 目录做完整备份。'), { status: 413 })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="shitu-backup-${today()}.zip"`)
    res.setHeader('X-Backup-Missing-Files', missing.length)
    await pipeline(Readable.from(zipChunks(entries2)), res)
  })

  const restoreUpload = multer({
    storage: multer.diskStorage({ destination: uploadDirectory, filename: (_req, file, cb) => cb(null, 'restore-' + randomUUID() + '.zip') }),
    limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(/\.zip$/i.test(file.originalname) || ['application/zip', 'application/x-zip-compressed'].includes(file.mimetype) ? null : invalid('请选择 .zip 备份文件'), true),
  })
  router.post('/restore', restoreUpload.single('backup'), async (req, res) => {
    if (!req.file) throw invalid('请选择备份压缩包')
    try {
      const files = readZip(await readFile(req.file.path))
      let manifest
      try { manifest = JSON.parse(files.get('backup.json')?.toString('utf8') ?? 'null') } catch { throw invalid('备份清单无法读取') }
      if (manifest?.format !== BACKUP_FORMAT || manifest?.version !== 1 || !manifest.data || typeof manifest.data !== 'object') throw invalid('这不是拾途导出的手帐备份')
      const plan = await buildRestorePlan(manifest.data, files)
      await applyRestore(plan, uploadDirectory)
      res.json({ restored: { trips: plan.trips.length, entries: plan.entries.length, photos: plan.photos.length, marks: plan.marks.length, canvas_groups: plan.groups.length, notebooks: plan.notebooks.length } })
    } finally {
      await unlink(req.file.path).catch(() => {})
    }
  })
}

async function buildRestorePlan(data, files) {
  const list = (value, label) => {
    if (value == null) return []
    if (!Array.isArray(value)) throw invalid(`备份的${label}无法读取`)
    return value
  }
  const trips = list(data.trips, '旅程'), entries = list(data.entries, '记录'), photos = list(data.photos, '照片'), marks = list(data.marks, '标注')
  const groups = list(data.canvas_groups, '色块'), groupPhotos = list(data.canvas_group_photos, '色块成员'), groupChildren = list(data.canvas_group_children, '色块层级')
  const notebooks = list(data.notebooks, '手札'), pages = list(data.notebook_pages, '手帐页')
  const tripMap = remap(trips, '旅程'), entryMap = remap(entries, '记录'), photoMap = remap(photos, '照片'), markMap = remap(marks, '标注')
  const groupMap = remap(groups, '色块'), notebookMap = remap(notebooks, '手札'), pageMap = remap(pages, '手帐页')
  const tripOf = value => value == null ? null : tripMap.get(uuid(value)) ?? null
  // 景点是本机基础资料，备份里的景点编号对应不上时置空，不阻塞还原。
  const [landmarkRows] = await pool.query('SELECT id FROM landmarks')
  const landmarkIds = new Set(landmarkRows.map(row => row.id))
  const restoreComponents = value => value == null ? null : JSON.stringify(parseComponents(value).map(part => {
    if (part.type === 'trip' && part.value) return { ...part, value: mapped(tripMap, part.value, '旅程组件') }
    if (part.type === 'place' && part.value?.landmark_id && !landmarkIds.has(part.value.landmark_id)) return { ...part, value: { ...part.value, landmark_id: null } }
    return part
  }))

  const tripRows = trips.map(trip => [tripMap.get(uuid(trip.id)), text(trip.name, 120, true), text(trip.region, 120), colors.includes(trip.color) ? trip.color : 'sage', coordinate(trip.canvas_x) ?? 0, coordinate(trip.canvas_y) ?? 0, timestamp(trip.created_at)])

  const entryRows = entries.map(entry => {
    let lat = null, lng = null
    if (entry.lat != null || entry.lng != null) { lat = number(entry.lat, -90, 90); lng = number(entry.lng, -180, 180) }
    const mood = entry.mood == null ? null : entry.mood
    if (mood != null && !moods.includes(mood)) throw invalid('备份里的心情无效')
    return [
      entryMap.get(uuid(entry.id)), tripOf(entry.trip_id), date(entry.entry_date), entry.captured_on ? date(entry.captured_on) : null,
      restoreComponents(entry.components),
      text(entry.title, 160), text(entry.caption, 10000), text(entry.place_name, 255),
      Number.isInteger(entry.landmark_id) && landmarkIds.has(entry.landmark_id) ? entry.landmark_id : null, lat, lng, text(entry.spot_key, 40), mood,
      coordinate(entry.canvas_x), coordinate(entry.canvas_y), rotation(entry.rotation),
      timestamp(entry.created_at), timestamp(entry.updated_at ?? entry.created_at),
    ]
  })

  // 照片文件统一改成新文件名写回 uploads，避免和现有文件混淆。
  const photoRows = [], fileWrites = [], renamed = new Map()
  for (const photo of photos) {
    const raw = typeof photo.url === 'string' ? photo.url : '', basename = path.basename(raw)
    if (!uploadPattern.test(raw)) throw invalid(`备份里有一个照片地址无效：${basename}`)
    let filename = renamed.get(basename)
    if (!filename) {
      const content = files.get('photos/' + basename)
      if (!content) throw invalid(`备份里缺少照片文件 ${basename}，这份备份不完整`)
      filename = randomUUID() + path.extname(basename)
      renamed.set(basename, filename)
      fileWrites.push({ filename, data: content })
    }
    photoRows.push([
      photoMap.get(uuid(photo.id)), mapped(entryMap, photo.entry_id, '照片'), '/uploads/' + filename,
      number(photo.crop_x ?? 50, 0, 100), filters.includes(photo.image_filter) ? photo.image_filter : 'original',
      restoreComponents(photo.components),
      coordinate(photo.canvas_x), coordinate(photo.canvas_y), photo.canvas_absolute ? 1 : 0, rotation(photo.rotation),
      Number.isSafeInteger(photo.sort_order) ? photo.sort_order : 0,
    ])
  }

  const markRows = marks.map(mark => {
    if (!['text', 'sticker'].includes(mark.kind)) throw invalid('备份里的标注类型无效')
    if (mark.kind === 'sticker' && !STICKERS.includes(mark.sticker)) throw invalid('备份里的贴纸无效')
    return [
      markMap.get(uuid(mark.id)), mark.kind, mark.kind === 'text' ? text(mark.text, 500) : null, mark.kind === 'sticker' ? mark.sticker : null,
      MARK_COLORS.includes(mark.color) ? mark.color : 'ink', MARK_SIZES.includes(mark.size) ? mark.size : 'medium',
      number(mark.canvas_x ?? 0, -1e7, 1e7), number(mark.canvas_y ?? 0, -1e7, 1e7), rotation(mark.rotation),
      mark.captured_on ? date(mark.captured_on) : today(),
      timestamp(mark.created_at),
    ]
  })

  const groupRows = groups.map(group => [groupMap.get(uuid(group.id)), text(group.name, 120, true), colors.includes(group.color) ? group.color : 'sage', group.collapsed ? 1 : 0, timestamp(group.created_at)])
  const groupPhotoRows = groupPhotos.map(member => [mapped(photoMap, member.photo_id, '色块成员'), mapped(groupMap, member.group_id, '色块成员')])
  const groupChildRows = groupChildren.map(child => [mapped(groupMap, child.child_id, '色块层级'), mapped(groupMap, child.parent_id, '色块层级')])
  const parents = new Map(groupChildRows)
  try { expandCanvasGroups(groupRows.map(([id]) => ({ id, parent_id: parents.get(id), photo_ids: [] }))) }
  catch { throw invalid('备份里的色块分组存在循环') }

  const pageRows = pages.map(page => [pageMap.get(uuid(page.id)), mapped(notebookMap, page.notebook_id, '手帐页'), Number.isSafeInteger(page.sort_order) ? page.sort_order : 0])
  const optionalPage = value => value == null ? null : pageMap.get(uuid(value)) ?? null
  const notebookRows = notebooks.map(book => {
    let coverUrl = null
    const coverMode = ['photo', 'solid', 'text'].includes(book.cover_mode) ? book.cover_mode : 'solid'
    const raw = typeof book.cover_url === 'string' ? book.cover_url : ''
    if (uploadPattern.test(raw)) {
      const basename = raw.slice('/uploads/'.length), content = files.get('photos/' + basename)
      if (!content) throw invalid(`备份里缺少封面文件 ${basename}，这份备份不完整`)
      if (content) {
        const filename = 'cover-' + randomUUID() + path.extname(basename)
        fileWrites.push({ filename, data: content })
        coverUrl = '/uploads/' + filename
      }
    } else if (/^\/(journal-demo\/[\w-]+\.(jpg|png|webp)|notebook-covers\/[\w-]+\.jpg)$/.test(raw)) coverUrl = raw
    return [
      notebookMap.get(uuid(book.id)), text(book.name, 120, true), coverUrl,
      typeof book.cover_label === 'string' ? book.cover_label.trim().slice(0, 60) : 'MEMO',
      typeof book.cover_text === 'string' && book.cover_text.trim() ? book.cover_text.trim().slice(0, 500) : '',
      coverUrl ? coverMode : coverMode === 'photo' ? 'solid' : coverMode,
      /^#[\da-f]{6}$/i.test(book.cover_color || '') ? book.cover_color : '#e3e9dd',
      optionalPage(book.bookmark_page_id), optionalPage(book.last_read_page_id),
      coordinate(book.canvas_x) ?? 0, coordinate(book.canvas_y) ?? 0, rotation(book.rotation),
      timestamp(book.created_at),
    ]
  })

  const itemRows = { photo: [], mark: [], entry: [] }
  for (const [kind, map, rows] of [['photo', photoMap, list(data.notebook_photo_items, '手帐页内容')], ['mark', markMap, list(data.notebook_mark_items, '手帐页内容')], ['entry', entryMap, list(data.notebook_entry_items, '手帐页内容')]]) {
    for (const item of rows) itemRows[kind].push([mapped(map, item.id, '手帐页内容'), mapped(pageMap, item.page_id, '手帐页内容'), number(item.x, 0, 1200), number(item.y, 0, 1600), rotation(item.rotation)])
  }

  return { trips: tripRows, entries: entryRows, photos: photoRows, marks: markRows, groups: groupRows, groupPhotos: groupPhotoRows, groupChildren: groupChildRows, notebooks: notebookRows, pages: pageRows, itemRows, fileWrites }
}

async function applyRestore(plan, uploadDirectory) {
  const created = []
  let connection
  try {
    for (const file of plan.fileWrites) {
      const handle = await open(path.join(uploadDirectory, file.filename), 'wx')
      created.push(file.filename)
      try { await handle.writeFile(file.data) } finally { await handle.close() }
    }
  } catch {
    await Promise.all(created.map(name => unlink(path.join(uploadDirectory, name)).catch(() => {})))
    throw invalid('备份里的照片文件写入失败，请重试')
  }
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    await bulkInsert(connection, 'journal_trips', ['id', 'name', 'region', 'color', 'canvas_x', 'canvas_y', 'created_at'], plan.trips)
    await bulkInsert(connection, 'journal_entries', ['id', 'trip_id', 'entry_date', 'captured_on', 'components', 'title', 'caption', 'place_name', 'landmark_id', 'lat', 'lng', 'spot_key', 'mood', 'canvas_x', 'canvas_y', 'rotation', 'created_at', 'updated_at'], plan.entries)
    await bulkInsert(connection, 'journal_photos', ['id', 'entry_id', 'url', 'crop_x', 'image_filter', 'components', 'canvas_x', 'canvas_y', 'canvas_absolute', 'rotation', 'sort_order'], plan.photos)
    await bulkInsert(connection, 'journal_marks', ['id', 'kind', 'text', 'sticker', 'color', 'size', 'canvas_x', 'canvas_y', 'rotation', 'captured_on', 'created_at'], plan.marks)
    await bulkInsert(connection, 'journal_canvas_groups', ['id', 'name', 'color', 'collapsed', 'created_at'], plan.groups)
    await bulkInsert(connection, 'journal_canvas_group_photos', ['photo_id', 'group_id'], plan.groupPhotos)
    await bulkInsert(connection, 'journal_canvas_group_children', ['child_id', 'parent_id'], plan.groupChildren)
    await bulkInsert(connection, 'journal_notebooks', ['id', 'name', 'cover_url', 'cover_label', 'cover_text', 'cover_mode', 'cover_color', 'bookmark_page_id', 'last_read_page_id', 'canvas_x', 'canvas_y', 'rotation', 'created_at'], plan.notebooks)
    await bulkInsert(connection, 'journal_notebook_pages', ['id', 'notebook_id', 'sort_order'], plan.pages)
    for (const [kind, rows] of Object.entries(plan.itemRows)) await bulkInsert(connection, `journal_notebook_${kind}_items`, ['id', 'page_id', 'x', 'y', 'rotation'], rows)
    await connection.commit()
  } catch {
    await connection?.rollback().catch(() => {})
    await Promise.all(created.map(name => unlink(path.join(uploadDirectory, name)).catch(() => {})))
    throw invalid('备份内容写入手帐时失败，现有数据没有变化')
  } finally {
    connection?.release()
  }
}
