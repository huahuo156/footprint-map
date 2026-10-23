import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { app, uploadDirectory } from './app.js'
import { initializeDatabase, pool } from './db.js'

let server, base, tripId
const entries = new Set()
const marks = new Set()
const canvasGroups = new Set()
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64')
test('unfolding saves the complete block displacement atomically and rejects foreign members', async () => {
  const created = await save({ photos:[{upload_index:0},{upload_index:1}] }, [png,png])
  const photos=(await record(created.data.id)).photos
  const positions=photos.map((p,i)=>({id:p.id,x:i*300,y:0,rotation:0}))
  const group=await json('/groups',{name:'展开避让',color:'sage',positions})
  assert.equal(group.status,201);canvasGroups.add(group.data.id)
  await json('/groups/'+group.data.id,{collapsed:true},'PATCH')
  const moved=positions.map(p=>({...p,y:800}))
  assert.equal((await json('/groups/'+group.data.id,{collapsed:false,positions:[moved[0],{...moved[1],id:'00000000-0000-0000-0000-000000000000'}]},'PATCH')).status,400)
  assert.ok((await record(created.data.id)).photos.every(p=>p.canvas_y===0))
  assert.equal((await json('/groups/'+group.data.id,{collapsed:false,positions:moved},'PATCH')).status,200)
  assert.ok((await record(created.data.id)).photos.every(p=>p.canvas_y===800))
  assert.equal((await json('')).data.canvas_groups.find(g=>g.id===group.data.id).collapsed,0)
})
before(async () => {
  await initializeDatabase()
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api/journal`
  const created = await json('/trips', { name: 'journal-integration-' + Date.now(), color: 'sage' })
  assert.equal(created.status, 201); tripId = created.data.id
})
after(async () => {
  for (const id of canvasGroups) await fetch(base + '/groups/' + id, { method: 'DELETE' })
  for (const id of marks) await fetch(base + '/marks/' + id, { method: 'DELETE' })
  for (const id of entries) await fetch(base + '/entries/' + id, { method: 'DELETE' })
  if (tripId) await pool.execute('DELETE FROM journal_trips WHERE id=?', [tripId])
  if (server) await new Promise(resolve => server.close(resolve))
  await pool.end()
})

test('text annotations and stickers persist, move, update and delete without photos or trips', async () => {
  const created = await json('/marks', { kind: 'text', text: '慢慢走，风景在路上。\n不用赶时间。', color: 'sky', size: 'large', rotation: -7, canvas_x: -600, canvas_y: 120 })
  assert.equal(created.status, 201); marks.add(created.data.id)
  const sticker = await json('/marks', { kind: 'sticker', sticker: 'flower', color: 'rose', size: 'small' })
  assert.equal(sticker.status, 201); marks.add(sticker.data.id)
  let record = (await json('')).data.marks.find(mark => mark.id === created.data.id)
  assert.equal(record.text, '慢慢走，风景在路上。\n不用赶时间。'); assert.equal(record.color, 'sky'); assert.equal(record.canvas_x, -600)
  assert.match(record.captured_on, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal((await json('/layout', { items: [{ kind: 'mark', id: record.id, x: 240, y: -75, rotation: 8 }] }, 'PATCH')).status, 200)
  assert.equal((await json('/marks/' + record.id, { kind: 'text', text: '后来又回来一次。', color: 'sage', size: 'medium', rotation: 8 }, 'PUT')).status, 200)
  record = (await json('')).data.marks.find(mark => mark.id === record.id)
  assert.equal(record.canvas_x, 240); assert.equal(record.canvas_y, -75); assert.equal(record.text, '后来又回来一次。')
  const savedSticker = (await json('')).data.marks.find(mark => mark.id === sticker.data.id)
  assert.equal(savedSticker.kind, 'sticker'); assert.equal(savedSticker.sticker, 'flower'); assert.equal(savedSticker.text, null)
  assert.equal((await fetch(base + '/marks/' + record.id, { method: 'DELETE' })).status, 200)
  assert.equal((await fetch(base + '/marks/' + record.id, { method: 'DELETE' })).status, 404)
  assert.equal((await json('/marks', { kind: 'text', text: '   ' })).status, 400)
  assert.equal((await json('/marks', { kind: 'text', text: '字'.repeat(501) })).status, 400)
  assert.equal((await json('/marks', { kind: 'sticker', sticker: 'unknown' })).status, 400)
  assert.equal((await json('/marks', { kind: 'sticker', sticker: 'sun', color: 'unknown' })).status, 400)
  assert.equal((await json('/marks', { kind: 'sticker', sticker: 'sun', canvas_x: 'invalid' })).status, 400)
})
async function json(route, body, method = 'POST') {
  const response = await fetch(base + route, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, data: await response.json() }
}
async function save(values, files = [], entryId) {
  const body = new FormData()
  body.append('data', JSON.stringify({ trip_id: tripId, entry_date: '2026-05-01', photos: [], ...values }))
  files.forEach(file => body.append('images', new Blob([file], { type: 'image/png' }), 'test.png'))
  const response = await fetch(base + '/entries' + (entryId ? '/' + entryId : ''), { method: entryId ? 'PUT' : 'POST', body })
  const data = await response.json()
  if (response.ok) entries.add(data.id)
  return { status: response.status, data }
}
async function record(id) { return (await json('')).data.entries.find(entry => entry.id === id) }

test('canvas groups persist membership and appearance, pin positions, move atomically and dissolve without deleting photos', async () => {
  const created = await save({ photos: [{ upload_index: 0 }, { upload_index: 1 }] }, [png, png])
  const photos = (await record(created.data.id)).photos
  const positions = photos.map((photo, i) => ({ id: photo.id, x: 200 + i * 300, y: 70, rotation: 3 }))
  const group = await json('/groups', { name: '湖边', color: 'sky', positions })
  assert.equal(group.status, 201); canvasGroups.add(group.data.id)
  let stored = (await json('')).data.canvas_groups.find(item => item.id === group.data.id)
  assert.equal(stored.name, '湖边'); assert.equal(stored.color, 'sky')
  assert.deepEqual(new Set(stored.photo_ids), new Set(photos.map(photo => photo.id)))
  assert.ok((await record(created.data.id)).photos.every(photo => photo.canvas_absolute))
  assert.equal((await json('/groups', { name: '部分照片', color: 'sage', positions: positions.slice(0, 1) })).status, 400)
  assert.equal((await json('/groups/' + group.data.id, { name: '湖畔', color: 'rose' }, 'PATCH')).status, 200)
  const moved = positions.map(photo => ({ ...photo, kind: 'photo', x: photo.x + 90, y: photo.y - 40 }))
  assert.equal((await json('/layout', { items: [...moved, { id: '00000000-0000-0000-0000-000000000000', kind: 'photo', x: 0, y: 0 }] }, 'PATCH')).status, 404)
  assert.equal((await record(created.data.id)).photos[0].canvas_x, 200)
  assert.equal((await json('/layout', { items: moved }, 'PATCH')).status, 200)
  assert.deepEqual((await record(created.data.id)).photos.map(photo => photo.canvas_x), [290, 590])
  stored = (await json('')).data.canvas_groups.find(item => item.id === group.data.id)
  assert.equal(stored.name, '湖畔'); assert.equal(stored.color, 'rose')
  assert.equal((await fetch(base + '/groups/' + group.data.id, { method: 'DELETE' })).status, 200)
  assert.equal((await record(created.data.id)).photos.length, 2)
  assert.equal((await json('')).data.canvas_groups.some(item => item.id === group.data.id), false)
  assert.equal((await json('/groups', { name: '无效', color: 'unknown', positions })).status, 400)
  assert.equal((await json('/groups', { name: '空', color: 'sage', positions: [] })).status, 400)
})
test('groups nest repeatedly and dissolve one layer while preserving child membership and photos', async () => {
  const created = await save({ photos: [0, 1, 2, 3].map(upload_index => ({ upload_index })) }, [png, png, png, png])
  const photos = (await record(created.data.id)).photos
  const positions = photos.map((photo, i) => ({ id: photo.id, x: i * 300, y: 80, rotation: 0 }))
  async function group(name, positions) {
    const result = await json('/groups', { name, color: 'sage', positions })
    assert.equal(result.status, 201, JSON.stringify(result.data)); canvasGroups.add(result.data.id)
    return result.data.id
  }
  const a = await group('内层一', positions.slice(0, 2)), b = await group('内层二', positions.slice(2, 3))
  const outer = await group('外层', positions.slice(0, 3)), top = await group('最外层', positions)
  let groups = (await json('')).data.canvas_groups
  assert.deepEqual(new Set(groups.find(item => item.id === top).photo_ids), new Set(photos.map(photo => photo.id)))
  assert.equal(groups.find(item => item.id === a).parent_id, outer)
  assert.equal(groups.find(item => item.id === outer).parent_id, top)
  assert.equal((await json('/groups', { name: '不可拆分', positions: positions.slice(0, 2) })).status, 400)
  assert.equal((await fetch(base + '/groups/' + outer, { method: 'DELETE' })).status, 200)
  groups = (await json('')).data.canvas_groups
  assert.equal(groups.find(item => item.id === a).parent_id, top)
  assert.equal(groups.find(item => item.id === b).parent_id, top)
  assert.equal((await fetch(base + '/groups/' + top, { method: 'DELETE' })).status, 200)
  groups = (await json('')).data.canvas_groups
  assert.equal(groups.find(item => item.id === a).parent_id, null)
  assert.equal(groups.find(item => item.id === b).parent_id, null)
  assert.equal((await record(created.data.id)).photos.length, 4)
  assert.equal((await json('/groups', { name: '失效照片', positions: [{ ...positions[0], id: '00000000-0000-0000-0000-000000000000' }] })).status, 404)
})

test('dissolving an inner group promotes its direct photos and overlapping concurrent grouping cannot split a block', async () => {
  const created = await save({ photos: [0, 1, 2].map(upload_index => ({ upload_index })) }, [png, png, png])
  const photos = (await record(created.data.id)).photos
  const positions = photos.map((photo, i) => ({ id: photo.id, x: i * 300, y: 0, rotation: 0 }))
  const results = await Promise.all([positions.slice(0, 2), positions.slice(1)].map(positions => json('/groups', { name: '并发分组', positions })))
  assert.deepEqual(results.map(result => result.status).sort(), [201, 400])
  const inner = results.find(result => result.status === 201).data; canvasGroups.add(inner.id)
  const outer = await json('/groups', { name: '外层', positions }); assert.equal(outer.status, 201); canvasGroups.add(outer.data.id)
  assert.equal((await fetch(base + '/groups/' + inner.id, { method: 'DELETE' })).status, 200)
  const stored = (await json('')).data.canvas_groups.find(group => group.id === outer.data.id)
  assert.deepEqual(new Set(stored.direct_photo_ids), new Set(photos.map(photo => photo.id)))
  assert.deepEqual(stored.child_group_ids, [])
  await fetch(base + '/photos/' + photos[0].id, { method: 'DELETE' })
  const remaining = (await json('')).data.canvas_groups.find(group => group.id === outer.data.id)
  assert.equal(remaining.photo_ids.length, 2)
})

test('folding groups persists independently from name, color, nested state and photo positions', async () => {
  const created = await save({ photos: [{ upload_index: 0 }, { upload_index: 1 }] }, [png, png])
  const photos = (await record(created.data.id)).photos
  const positions = photos.map((photo, i) => ({ id: photo.id, x: i * 500, y: 70, rotation: 3 }))
  const inner = await json('/groups', { name: '内层', color: 'sky', positions }); assert.equal(inner.status, 201); canvasGroups.add(inner.data.id)
  const outer = await json('/groups', { name: '外层', color: 'rose', positions }); assert.equal(outer.status, 201); canvasGroups.add(outer.data.id)
  const before = (await record(created.data.id)).photos
  assert.equal((await json('/groups/' + inner.data.id, { collapsed: true }, 'PATCH')).status, 200)
  assert.equal((await json('/groups/' + outer.data.id, { collapsed: true }, 'PATCH')).status, 200)
  assert.equal((await json('/groups/' + outer.data.id, { collapsed: false }, 'PATCH')).status, 200)
  const groups = (await json('')).data.canvas_groups
  assert.equal(Boolean(groups.find(group => group.id === inner.data.id).collapsed), true)
  const stored = groups.find(group => group.id === outer.data.id)
  assert.equal(Boolean(stored.collapsed), false); assert.equal(stored.name, '外层'); assert.equal(stored.color, 'rose')
  assert.deepEqual((await record(created.data.id)).photos, before)
  assert.equal((await json('/groups/' + outer.data.id, { collapsed: 'false' }, 'PATCH')).status, 400)
  assert.equal((await json('/groups/' + outer.data.id, {}, 'PATCH')).status, 400)
  assert.equal((await json('/groups/00000000-0000-0000-0000-000000000000', { collapsed: true }, 'PATCH')).status, 404)
})

test('multipart photos, date, place, metadata, layout and edits survive another read', async () => {
  const created = await save({ place_name: '西湖', caption: '湖边坐了一下午。', spot_key: 'bridge', lat: 30.2596, lng: 120.1517, photos: [{ upload_index: 0 }, { upload_index: 1, image_filter: 'film' }] }, [png, png])
  assert.equal(created.status, 201)
  const entry = await record(created.data.id)
  assert.equal(entry.entry_date, '2026-05-01'); assert.equal(entry.photos.length, 2)
  const first = entry.photos[0], removed = entry.photos[1]
  assert.equal((await fetch(base.replace('/api/journal', '') + first.url)).status, 200)
  const layout = await json('/layout', { items: [{ id: first.id, kind: 'photo', x: 812.5, y: -210, rotation: 4 }] }, 'PATCH')
  assert.equal(layout.status, 200)
  const edited = await save({ entry_date: '2026-05-02', title: '湖边的一页', caption: '第二次保存', photos: [{ id: first.id, crop_x: 28, image_filter: 'mono' }, { upload_index: 0 }] }, [png], entry.id)
  assert.equal(edited.status, 200)
  const stored = await record(entry.id)
  assert.equal(stored.entry_date, '2026-05-02'); assert.equal(stored.title, '湖边的一页')
  assert.equal(stored.photos[0].canvas_x, 812.5); assert.equal(stored.photos[0].crop_x, 28); assert.equal(stored.photos[0].image_filter, 'mono')
  assert.equal(stored.photos.length, 2)
  await assert.rejects(access(path.join(uploadDirectory, path.basename(removed.url))))
})
test('a text-only memory can be saved and deleted with its layout', async () => {
  const created = await save({ caption: '没拍照，但记住了这一天。' })
  assert.equal(created.status, 201)
  assert.equal((await record(created.data.id)).photos.length, 0)
  assert.equal((await json('/layout', { items: [{ kind: 'entry', id: created.data.id, x: -300, y: 42 }] }, 'PATCH')).status, 200)
  assert.equal((await record(created.data.id)).canvas_y, 42)
  assert.equal((await fetch(base + '/entries/' + created.data.id, { method: 'DELETE' })).status, 200)
  assert.equal(await record(created.data.id), undefined)
  entries.delete(created.data.id)
})

test('batch components span records, preserve siblings and layout, and roll back as one transaction', async () => {
  const first = await save({ caption: '原有描述', place_name: '原有地点', photos: [{ upload_index: 0 }, { upload_index: 1 }] }, [png, png])
  const second = await save({ photos: [{ upload_index: 0, components: [{ type: 'mood', value: '惊喜' }, { type: 'description', value: '另一张独有的描述' }] }] }, [png])
  let a = await record(first.data.id), b = await record(second.data.id)
  const selected = [a.photos[0].id, b.photos[0].id], sibling = structuredClone(a.photos[1])
  const positions = selected.map((id, index) => ({ id, x: 721 + index * 300, y: -412, rotation: 3 }))
  const result = await json('/photos/components', { photo_ids: selected, components: [{ type: 'place', value: { name: '西湖' } }, { type: 'date', value: '2026-09-01' }, { type: 'trip', value: tripId }], positions }, 'PATCH')
  assert.equal(result.status, 200); assert.equal(result.data.saved, 2)
  a = await record(a.id); b = await record(b.id)
  assert.deepEqual(a.photos[1], sibling)
  assert.equal(a.caption, '原有描述')
  assert.equal(a.photos[0].components.find(part => part.type === 'description').value, '原有描述')
  assert.equal(b.photos[0].components.find(part => part.type === 'description').value, '另一张独有的描述')
  assert.equal(b.photos[0].components.find(part => part.type === 'mood').value, '惊喜')
  for (const [index, photo] of [a.photos[0], b.photos[0]].entries()) {
    assert.equal(photo.components.find(part => part.type === 'place').value.name, '西湖')
    assert.equal(photo.canvas_x, positions[index].x); assert.equal(photo.canvas_y, -412); assert.equal(photo.canvas_absolute, 1)
  }
  const invalidId = '00000000-0000-4000-8000-000000000000'
  assert.equal((await json('/photos/components', { photo_ids: [selected[0], invalidId], components: [{ type: 'description', value: '不应保存' }] }, 'PATCH')).status, 404)
  assert.equal((await json('/photos/components', { photo_ids: selected, components: [{ type: 'trip', value: invalidId }] }, 'PATCH')).status, 400)
  assert.equal((await record(a.id)).photos[0].components.find(part => part.type === 'description').value, '原有描述')
  assert.equal((await json('/photos/components', { photo_ids: [selected[0], selected[0]], components: [{ type: 'mood', value: '开心' }] }, 'PATCH')).status, 400)
  assert.equal((await json('/photos/components', { photo_ids: selected, components: [] }, 'PATCH')).status, 400)
  assert.equal((await json('/photos/components', { photo_ids: selected, components: [{ type: 'date', value: '2026-02-30' }] }, 'PATCH')).status, 400)
  assert.equal((await json('/photos/components', { photo_ids: selected, components: [{ type: 'mood', value: '开心' }], positions: [positions[0]] }, 'PATCH')).status, 400)
  assert.equal((await json('/photos/components', { photo_ids: selected, components: [{ type: 'description', value: '' }] }, 'PATCH')).status, 200)
  a = await record(a.id); b = await record(b.id)
  assert.ok(!a.photos[0].components.some(part => part.type === 'description'))
  assert.ok(!b.photos[0].components.some(part => part.type === 'description'))
  assert.deepEqual(a.photos[1], sibling)
  assert.equal(a.photos[0].canvas_x, positions[0].x)
})

test('batch deletion is atomic, removes empty photo records and keeps other photos, notes and marks', async () => {
  const first = await save({ photos: [{ upload_index: 0 }, { upload_index: 1 }, { upload_index: 2 }] }, [png, png, png])
  const second = await save({ photos: [{ upload_index: 0 }] }, [png])
  const note = await save({ caption: '文字仍然保留' })
  const a = await record(first.data.id), b = await record(second.data.id)
  const selected = [a.photos[0], b.photos[0]], ids = selected.map(photo => photo.id)
  const marksBefore = (await json('')).data.marks
  const invalidId = '00000000-0000-4000-8000-000000000000'
  assert.equal((await json('/photos', { photo_ids: [ids[0], invalidId] }, 'DELETE')).status, 404)
  assert.deepEqual((await record(a.id)).photos, a.photos)
  for (const photo of selected) await access(path.join(uploadDirectory, path.basename(photo.url)))
  assert.equal((await json('/photos', { photo_ids: [] }, 'DELETE')).status, 400)
  assert.equal((await json('/photos', { photo_ids: [ids[0], ids[0]] }, 'DELETE')).status, 400)
  const result = await json('/photos', { photo_ids: ids }, 'DELETE')
  assert.equal(result.status, 200); assert.equal(result.data.deleted, 2)
  assert.deepEqual((await record(a.id)).photos, a.photos.slice(1))
  assert.equal(await record(b.id), undefined)
  assert.equal((await record(note.data.id)).caption, '文字仍然保留')
  assert.deepEqual((await json('')).data.marks, marksBefore)
  for (const photo of selected) await assert.rejects(access(path.join(uploadDirectory, path.basename(photo.url))))
  await access(path.join(uploadDirectory, path.basename(a.photos[1].url)))
})

test('mixed canvas deletion includes text and stickers, rolls back missing targets, and protects siblings', async () => {
  const saved = await save({ photos: [{ upload_index: 0 }, { upload_index: 1 }] }, [png, png])
  const entry = await record(saved.data.id), note = await save({ caption: '选中的文字记录' })
  const text = await json('/marks', { kind: 'text', text: '选中的纸卡' }), sticker = await json('/marks', { kind: 'sticker', sticker: 'flower' })
  marks.add(text.data.id); marks.add(sticker.data.id)
  const marksBefore = (await json('')).data.marks
  const items = [{ kind: 'photo', id: entry.photos[0].id }, { kind: 'entry', id: note.data.id }, { kind: 'mark', id: text.data.id }, { kind: 'mark', id: sticker.data.id }]
  assert.equal((await json('/items', { items: [items[0], { kind: 'mark', id: '00000000-0000-4000-8000-000000000000' }] }, 'DELETE')).status, 404)
  assert.deepEqual((await record(entry.id)).photos, entry.photos)
  assert.equal((await json('/items', { items: [{ kind: 'entry', id: entry.id }] }, 'DELETE')).status, 400)
  assert.equal((await json('/items', { items: [items[0], items[0]] }, 'DELETE')).status, 400)
  assert.equal((await json('/items', { items: [{ kind: 'unknown', id: entry.id }] }, 'DELETE')).status, 400)
  assert.equal((await json('/items', { items: [] }, 'DELETE')).status, 400)
  assert.ok(await record(note.data.id))
  assert.deepEqual((await json('')).data.marks, marksBefore)
  const deleted = await json('/items', { items }, 'DELETE')
  assert.equal(deleted.status, 200); assert.equal(deleted.data.deleted, 4)
  assert.equal(await record(note.data.id), undefined)
  assert.deepEqual((await record(entry.id)).photos, entry.photos.slice(1))
  assert.deepEqual((await json('')).data.marks, marksBefore.filter(mark => mark.id !== text.data.id && mark.id !== sticker.data.id))
  await assert.rejects(access(path.join(uploadDirectory, path.basename(entry.photos[0].url))))
  await access(path.join(uploadDirectory, path.basename(entry.photos[1].url)))
})
test('invalid date, image, missing uploads and foreign photos roll back without orphan files', async () => {
  const beforeFiles = (await readdir(uploadDirectory)).sort()
  assert.equal((await save({ entry_date: '2026-02-30', photos: [{ upload_index: 0 }] }, [png])).status, 400)
  assert.equal((await save({ photos: [{ upload_index: 0 }] }, [Buffer.from('not a png')])).status, 400)
  assert.equal((await save({ photos: [{ upload_index: 0 }] })).status, 400)
  assert.equal((await save({ photos: [null], caption: 'invalid' })).status, 400)
  assert.equal((await save({ photos: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }] })).status, 400)
  assert.deepEqual((await readdir(uploadDirectory)).sort(), beforeFiles)
})

test('image validation identifies every invalid upload and rolls back the whole chunk', async () => {
  const beforeFiles = (await readdir(uploadDirectory)).sort()
  const result = await save({ photos: [0, 1, 2].map(upload_index => ({ upload_index })) }, [Buffer.from('bad image'), png, Buffer.from('another bad image')])
  assert.equal(result.status, 400)
  assert.equal(result.data.code, 'INVALID_IMAGES')
  assert.deepEqual(result.data.invalidFiles.map(file => file.index), [0, 2])
  assert.ok(result.data.invalidFiles.every(file => file.reason.includes('未识别')))
  assert.deepEqual((await readdir(uploadDirectory)).sort(), beforeFiles)
})

test('valid images with misleading MIME types use their actual format, including cleanup on rollback', async () => {
  const body = new FormData()
  body.append('data', JSON.stringify({ components: [], photos: [{ upload_index: 0 }] }))
  body.append('images', new Blob([png], { type: 'image/jpeg' }), 'actually-png.jpg')
  const response = await fetch(base + '/entries', { method: 'POST', body }), result = await response.json()
  assert.equal(response.status, 201); entries.add(result.id)
  const entry = await record(result.id)
  assert.match(entry.photos[0].url, /\.png$/)
  const image = await fetch(base.replace('/api/journal', '') + entry.photos[0].url)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png)

  const beforeFiles = (await readdir(uploadDirectory)).sort()
  body.set('data', JSON.stringify({ components: [], photos: [{ upload_index: 1 }] }))
  assert.equal((await fetch(base + '/entries', { method: 'POST', body })).status, 400)
  assert.deepEqual((await readdir(uploadDirectory)).sort(), beforeFiles)
})
test('legacy import is idempotent and keeps modern entries unchanged', async () => {
  const before = await json('')
  await initializeDatabase()
  const after = await json('')
  assert.deepEqual(after.data.entries.map(entry => entry.id).sort(), before.data.entries.map(entry => entry.id).sort())
})

test('bare photos need no trip and ordered components persist independently per photo', async () => {
  const parts = [{ type: 'mood', value: '惊喜' }, { type: 'description', value: '只给第一张的描述' }, { type: 'trip', value: tripId }]
  const created = await save({ trip_id: null, components: [], photos: [{ upload_index: 0, components: parts }, { upload_index: 1, components: [] }] }, [png, png])
  assert.equal(created.status, 201)
  const stored = await record(created.data.id)
  assert.equal(stored.trip_id, null); assert.equal(stored.mood, null)
  assert.deepEqual(stored.photos[0].components, parts); assert.deepEqual(stored.photos[1].components, [])
  const deletedUrl = stored.photos[0].url
  assert.equal((await fetch(base + '/photos/' + stored.photos[0].id, { method: 'DELETE' })).status, 200)
  const remaining = await record(created.data.id)
  assert.equal(remaining.photos.length, 1); assert.equal(remaining.photos[0].id, stored.photos[1].id)
  await assert.rejects(access(path.join(uploadDirectory, path.basename(deletedUrl))))
  const updated = await save({ trip_id: null, components: [], photos: [{ id: remaining.photos[0].id, components: [{ type: 'place', value: { name: '西湖', lat: 30.2596, lng: 120.1517 } }] }] }, [], remaining.id)
  assert.equal(updated.status, 200)
  assert.equal((await record(remaining.id)).photos[0].components[0].value.name, '西湖')
})
test('duplicate, invalid and nonexistent journey components fail without storing files', async () => {
  const baseline = (await readdir(uploadDirectory)).sort()
  for (const parts of [[{ type: 'mood', value: '开心' }, { type: 'mood', value: '平静' }], [{ type: 'date', value: '2026-02-30' }], [{ type: 'trip', value: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }]]) {
    assert.equal((await save({ trip_id: null, photos: [{ upload_index: 0, components: parts }] }, [png])).status, 400)
  }
  assert.deepEqual((await readdir(uploadDirectory)).sort(), baseline)
})
