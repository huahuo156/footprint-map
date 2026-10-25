import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app, uploadDirectory } from './app.js'
import { initializeDatabase, pool } from './db.js'
import { readZip, zipChunks } from './zip.js'

let server, base
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64')
// 还原是合并语义：记录需要清理的编号，测试后一并删除，不影响其他用例。
const created = { trips: new Set(), entries: new Set(), marks: new Set(), groups: new Set(), notebooks: new Set() }

before(async () => {
  assert.match(process.env.MYSQL_DATABASE || '', /test/i, '备份还原测试必须使用独立测试库')
  assert.equal(process.env.MYSQL_PORT, '3308', '备份还原测试必须使用独立 3308 实例')
  await initializeDatabase()
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api/journal`
})
after(async () => {
  for (const id of created.groups) await fetch(base + '/groups/' + id, { method: 'DELETE' })
  for (const id of created.marks) await fetch(base + '/marks/' + id, { method: 'DELETE' })
  for (const id of created.entries) await fetch(base + '/entries/' + id, { method: 'DELETE' })
  for (const id of created.notebooks) await fetch(base + '/notebooks/' + id, { method: 'DELETE' })
  for (const id of created.trips) await pool.execute('DELETE FROM journal_trips WHERE id=?', [id]).catch(() => {})
  if (server) await new Promise(resolve => server.close(resolve))
  await pool.end()
})

test('backup packs photos with a manifest, restore merges everything as new content', async () => {
  const trip = await json('/trips', { name: 'backup-integration-' + Date.now(), color: 'sky', region: '杭州' })
  assert.equal(trip.status, 201); created.trips.add(trip.data.id)
  const saved = await save({ trip_id: trip.data.id, title: '备份集成记录', photos: [0, 1].map(upload_index => ({ upload_index, components: [{ type: 'date', value: '2024-05-01' }, { type: 'trip', value: trip.data.id }] })) }, [png, png])
  assert.equal(saved.status, 201); created.entries.add(saved.data.id)
  const photo = (await record(saved.data.id)).photos[0]
  const outsidePhoto = (await record(saved.data.id)).photos[1]
  const mark = await json('/marks', { kind: 'text', text: '备份里的字条', canvas_x: 30, canvas_y: 40 })
  assert.equal(mark.status, 201); created.marks.add(mark.data.id)
  const notebook = await json('/notebooks', { name: '备份手札', canvas_x: 0, canvas_y: 0 })
  assert.equal(notebook.status, 201); created.notebooks.add(notebook.data.id)
  const group = await json('/groups', { name: '备份色块', color: 'rose', positions: [{ id: outsidePhoto.id, x: 100, y: 120, rotation: 3 }] })
  assert.equal(group.status, 201); created.groups.add(group.data.id)
  const pageId = (await json('')).data.notebook_pages.find(page => page.notebook_id === notebook.data.id).id
  assert.equal((await json(`/notebook-pages/${pageId}/items`, { items: [{ kind: 'photo', id: photo.id, x: 100, y: 200, rotation: 0 }] })).status, 200)
  const coverForm = new FormData(); coverForm.append('image', new Blob([png], { type: 'image/png' }), 'cover.png')
  const cover = await (await fetch(base + '/notebook-covers', { method: 'POST', body: coverForm })).json()
  assert.equal((await json('/notebooks/' + notebook.data.id, { cover_url: cover.url, cover_mode: 'photo', cover_label: '' }, 'PATCH')).status, 200)
  assert.equal((await json('/notebooks/' + notebook.data.id + '/reading', { bookmark_page_id: pageId, last_read_page_id: pageId }, 'PATCH')).status, 200)

  const response = await fetch(base + '/backup')
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type'), /zip/)
  assert.match(response.headers.get('content-disposition'), /shitu-backup-\d{4}-\d{2}-\d{2}\.zip/)
  const archive = Buffer.from(await response.arrayBuffer())
  const files = readZip(archive)
  const manifest = JSON.parse(files.get('backup.json').toString('utf8'))
  assert.equal(manifest.format, 'shitu-journal-backup')
  assert.equal(manifest.version, 1)
  assert.deepEqual(manifest.missing_files, [])
  const exportedPhoto = manifest.data.photos.find(row => row.id === photo.id)
  assert.ok(exportedPhoto, '备份清单里包含这张照片')
  assert.ok(files.has('photos/' + exportedPhoto.url.split('/').pop()), '照片文件随备份打包')

  // Only restore this fixture, even when the test database has other test data.
  for (const key of ['trips', 'entries', 'marks', 'notebooks']) manifest.data[key] = manifest.data[key].filter(row => created[key].has(row.id))
  manifest.data.photos = manifest.data.photos.filter(row => row.entry_id === saved.data.id)
  manifest.data.canvas_groups = manifest.data.canvas_groups.filter(row => row.id === group.data.id)
  manifest.data.canvas_group_photos = manifest.data.canvas_group_photos.filter(row => row.group_id === group.data.id)
  manifest.data.canvas_group_children = []
  manifest.data.notebook_pages = manifest.data.notebook_pages.filter(row => row.notebook_id === notebook.data.id)
  manifest.data.notebook_photo_items = manifest.data.notebook_photo_items.filter(row => row.id === photo.id)
  manifest.data.notebook_mark_items = []; manifest.data.notebook_entry_items = []
  const chunks = []
  for await (const chunk of zipChunks([...files].map(([name, data]) => ({ name, data: name === 'backup.json' ? Buffer.from(JSON.stringify(manifest)) : data })))) chunks.push(chunk)
  const beforeRestore = (await json('')).data
  const restored = await send('/restore', Buffer.concat(chunks))
  const after = await json('')
  for (const key of Object.keys(created)) {
    const rows = key === 'groups' ? 'canvas_groups' : key
    const previous = new Set(beforeRestore[rows].map(row => row.id))
    for (const row of after.data[rows]) if (!previous.has(row.id)) created[key].add(row.id)
  }
  assert.equal(restored.status, 200)
  assert.equal(restored.data.restored.photos, 2)
  assert.equal(restored.data.restored.entries, 1)
  assert.equal(restored.data.restored.canvas_groups, 1)
  assert.equal(restored.data.restored.notebooks, 1)

  const cloned = after.data.entries.find(row => !beforeRestore.entries.some(old => old.id === row.id) && row.title === '备份集成记录')
  assert.ok(cloned, '还原生成了新的记录')
  assert.equal(cloned.created_at, manifest.data.entries[0].created_at, '还原保留原始创建时间')
  created.entries.add(cloned.id)
  const clonedTrip = after.data.trips.find(row => row.id !== trip.data.id && row.name === trip.data.name)
  assert.deepEqual(cloned.photos[0].components, [{ type: 'date', value: '2024-05-01' }, { type: 'trip', value: clonedTrip.id }])
  const clonedPhoto = cloned.photos[0]
  assert.notEqual(clonedPhoto.url, photo.url, '还原的照片使用新的文件名')
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}` + clonedPhoto.url)).status, 200, '新文件已写入 uploads')
  for (const newTrip of after.data.trips.filter(row => row.name === trip.data.name && !created.trips.has(row.id))) created.trips.add(newTrip.id)
  assert.equal(after.data.trips.filter(row => row.name === trip.data.name).length, 2, '旅程按新编号合并')
  const clonedGroup = after.data.canvas_groups.find(row => !beforeRestore.canvas_groups.some(old => old.id === row.id) && row.name === '备份色块')
  assert.ok(clonedGroup); created.groups.add(clonedGroup.id)
  assert.deepEqual(clonedGroup.photo_ids, [cloned.photos[1].id], '色块成员指向还原后的画布照片')
  const clonedMark = after.data.marks.find(row => !beforeRestore.marks.some(old => old.id === row.id) && row.text === '备份里的字条')
  assert.ok(clonedMark); created.marks.add(clonedMark.id)
  const clonedBook = after.data.notebooks.find(row => !beforeRestore.notebooks.some(old => old.id === row.id) && row.name === '备份手札')
  assert.ok(clonedBook); created.notebooks.add(clonedBook.id)
  const clonedPage = after.data.notebook_pages.find(page => page.notebook_id === clonedBook.id)
  assert.equal(clonedBook.bookmark_page_id, clonedPage.id)
  assert.equal(clonedBook.last_read_page_id, clonedPage.id)
  assert.notEqual(clonedBook.cover_url, cover.url)
  assert.equal(clonedBook.cover_label, '')
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}` + clonedBook.cover_url)).status, 200)
  assert.ok(after.data.notebook_items.some(item => item.kind === 'photo' && item.id === clonedPhoto.id && item.page_id === clonedPage.id), '手帐页上的照片指向新页与新照片')
  assert.equal((await json('/notebooks/' + clonedBook.id, { cover_url: null, cover_mode: 'solid' }, 'PATCH')).status, 200)
  assert.equal((await json('/notebook-covers?url=' + encodeURIComponent(clonedBook.cover_url), {}, 'DELETE')).status, 200)
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}` + clonedBook.cover_url)).status, 404, '替换还原后的封面会清理旧文件')
})

test('restore rejects files that are not shitu backups', async () => {
  assert.equal((await send('/restore', Buffer.from('这不是压缩包'))).status, 400)
  assert.equal((await send('/restore', Buffer.from('PK\0\0没有内容'))).status, 400)
  const wrong = await fetch(base + '/restore', { method: 'POST', body: (() => { const body = new FormData(); body.append('backup', new Blob([png], { type: 'image/png' }), 'photo.png'); return body })() })
  assert.equal(wrong.status, 400)
})

test('export lists uploads that disappeared from disk as missing files', async () => {
  const saved = await save({ photos: [{ upload_index: 0 }] }, [png])
  assert.equal(saved.status, 201); created.entries.add(saved.data.id)
  const photo = (await record(saved.data.id)).photos[0]
  await unlink(path.join(uploadDirectory, photo.url.split('/').pop()))
  const response = await fetch(base + '/backup')
  const manifest = JSON.parse(readZip(Buffer.from(await response.arrayBuffer())).get('backup.json').toString('utf8'))
  assert.ok(manifest.missing_files.includes(photo.url), '缺失的照片记入 missing_files')
})

test('restore rejects cyclic canvas groups without affecting existing journal access', async () => {
  const id = randomUUID(), name = 'cycle-test-' + id
  const archive = await pack({ canvas_groups: [{ id, name }], canvas_group_children: [{ child_id: id, parent_id: id }] })
  const restored = await send('/restore', archive)
  // Clean up even when this regression fails, so a broken graph cannot poison later tests.
  await pool.execute('DELETE FROM journal_canvas_groups WHERE name=?', [name])
  assert.equal(restored.status, 400)
  assert.equal((await json('')).status, 200)
})

test('restore rolls back rows and cleans new photos when a database write fails', async () => {
  assert.equal(process.env.MYSQL_PORT, '3308')
  const entry = randomUUID(), photo = randomUUID(), book = randomUUID(), page = randomUUID()
  const archive = await pack({ entries: [{ id: entry, entry_date: '2024-05-01', title: 'restore-rollback-' + entry }], photos: [{ id: photo, entry_id: entry, url: '/uploads/test.png' }], notebooks: [{ id: book, name: 'rollback-book' }], notebook_pages: [{ id: page, notebook_id: book, sort_order: 0 }] }, [{ name: 'photos/test.png', data: png }])
  const beforeFiles = (await readdir(uploadDirectory)).sort()
  await pool.query("CREATE TRIGGER backup_test_failure BEFORE INSERT ON journal_notebook_pages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='simulated restore failure'")
  let restored
  try { restored = await send('/restore', archive) }
  finally { await pool.query('DROP TRIGGER backup_test_failure') }
  assert.equal(restored.status, 400)
  const [[row]] = await pool.execute('SELECT COUNT(*) AS n FROM journal_entries WHERE title=?', ['restore-rollback-' + entry])
  assert.equal(row.n, 0)
  assert.deepEqual((await readdir(uploadDirectory)).sort(), beforeFiles)
})

async function pack(data, files = []) {
  const chunks = []
  for await (const chunk of zipChunks([{ name: 'backup.json', data: Buffer.from(JSON.stringify({ format: 'shitu-journal-backup', version: 1, data })) }, ...files])) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function json(route, body, method = 'POST') {
  const response = await fetch(base + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, data: await response.json() }
}
async function send(route, buffer) {
  const body = new FormData()
  body.append('backup', new Blob([buffer], { type: 'application/zip' }), 'backup.zip')
  const response = await fetch(base + route, { method: 'POST', body })
  return { status: response.status, data: await response.json() }
}
async function save(values, files = []) {
  const body = new FormData()
  body.append('data', JSON.stringify({ entry_date: '2024-05-01', ...values }))
  files.forEach(file => body.append('images', new Blob([file], { type: 'image/png' }), 'test.png'))
  const response = await fetch(base + '/entries', { method: 'POST', body })
  const data = await response.json()
  return { status: response.status, data }
}
async function record(id) { return (await json('')).data.entries.find(entry => entry.id === id) }
