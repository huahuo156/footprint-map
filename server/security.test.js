import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { readdir, stat, rename, copyFile, open, writeFile, utimes } from 'node:fs/promises'
import { openAsBlob, createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import argon2 from 'argon2'
import sharp from 'sharp'
import { app, uploadDirectory } from './app.js'
import { pool } from './db.js'
import { createLayoutUser } from './layout-session.js'
import { readZip, zipChunks } from './zip.js'
import { collectUnusedAssets } from './asset-lifecycle.js'
import { metricsSnapshot } from './telemetry.js'
import { runMaintenance } from './operations.js'
import { createLayoutPersistence } from '../src/journal/canvas/persistence.js'

if (!/^footprint_security_test_[a-f0-9]{12}$/.test(process.env.MYSQL_DATABASE || '') || process.env.MYSQL_DATABASE !== process.env.SECURITY_TEST_DATABASE) throw new Error('Use npm run test:api: isolated disposable database required')
const origin = process.env.APP_ORIGIN
let server, base, a, b, unverified
async function account(email, verified = true) {
  const id = randomUUID(), password = 'security-test-password-123'
  await createLayoutUser(pool, { id, email, passwordHash: await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }), emailVerifiedAt: verified ? new Date() : null })
  const response = await fetch(base + '/api/auth/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  assert.equal(response.status, 200)
  const session = await response.json()
  return { id, cookie: response.headers.get('set-cookie').split(';')[0], csrf: session.csrfToken }
}
async function request(user, route, body, method = body === undefined ? 'GET' : 'POST') {
  const headers = user ? { Cookie: user.cookie, 'X-CSRF-Token': user.csrf, Origin: origin } : {}
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  return fetch(base + route, { method, headers, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) })
}
async function json(user, route, body, method) {
  const response = await request(user, route, body, method)
  const data = await response.json()
  assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(data)}`)
  return data
}
async function photo(user) {
  const image = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#aacccc' } }).png().toBuffer()
  const form = new FormData()
  form.set('data', JSON.stringify({ caption: 'private photo', photos: [{ upload_index: 0 }] }))
  form.append('images', new Blob([image], { type: 'image/png' }), 'private.png')
  return json(user, '/api/journal/entries', form)
}
before(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
  a = await account('a@example.com'); b = await account('b@example.com'); unverified = await account('unverified@example.com', false)
})
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); await pool.end() })

test('mark mutations protect structure and row versions with atomic rollback', async () => {
  const readStructure = async user => (await pool.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [user.id]))[0][0].v
  const initial = await readStructure(a)
  const mark = await json(a, '/api/journal/marks', { kind: 'text', text: 'version fixture', expected_structure_version: initial })
  const structure = await readStructure(a)
  assert.equal(structure, String(BigInt(initial) + 1n))
  const route = '/api/journal/marks/' + mark.id
  const readMark = async () => (await pool.execute('SELECT rotation,text,CAST(layout_version AS CHAR) AS v FROM journal_marks WHERE id=?', [mark.id]))[0][0]
  const body = { kind: 'text', text: 'rotated', rotation: 2, expected_structure_version: structure, expected_version: '0' }
  const race = await Promise.all([request(a, route, body, 'PUT'), request(a, route, { ...body, rotation: 3 }, 'PUT')])
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
  const saved = await readMark(); assert.equal(saved.v, '1')
  await json(a, route, { ...body, text: 'content only', rotation: saved.rotation, expected_version: '1' }, 'PUT')
  assert.equal((await readMark()).v, '1')
  assert.equal((await request(b, route, { kind: 'text', text: 'foreign' }, 'PUT')).status, 404)
  assert.equal((await request(a, route, { expected_structure_version: initial }, 'DELETE')).status, 409)
  await pool.query("ALTER TABLE journal_marks ADD CONSTRAINT mark_write_failure CHECK (text <> 'forced-mark-failure')")
  try {
    assert.equal((await request(a, route, { ...body, text: 'forced-mark-failure', rotation: 9, expected_version: '1' }, 'PUT')).status, 500)
    assert.deepEqual(await readMark(), { ...saved, text: 'content only' })
  } finally { await pool.query('ALTER TABLE journal_marks DROP CHECK mark_write_failure') }
  assert.equal(await readStructure(a), structure)
  await json(a, route, { kind: 'text', text: 'legacy', rotation: 8 }, 'PUT')
  assert.equal((await readMark()).v, '2')
  await json(a, route, { expected_structure_version: structure }, 'DELETE')
  assert.equal(await readMark(), undefined)
  assert.equal(await readStructure(a), String(BigInt(structure) + 1n))
})

test('batch photo content and layout changes reject conflicts and roll back atomically', async () => {
  const entryA = await photo(a), entryB = await photo(a), foreign = await photo(b)
  const ids = async entry => (await pool.execute('SELECT id FROM journal_photos WHERE entry_id=?', [entry.id]))[0][0].id
  const first = await ids(entryA), second = await ids(entryB), foreignId = await ids(foreign)
  const structure = (await pool.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [a.id]))[0][0].v
  const read = async () => (await pool.execute('SELECT id,canvas_x,canvas_y,rotation,components,CAST(layout_version AS CHAR) AS v FROM journal_photos WHERE id IN (?,?) ORDER BY id', [first, second]))[0]
  const route = '/api/journal/photos/components'
  const body = { photo_ids: [first, second], components: [{ type: 'description', value: 'batch changed' }], expected_structure_version: structure, positions: [{ id: first, x: 10, y: 20, expected_version: '0' }, { id: second, x: 30, y: 40, expected_version: '0' }] }
  const race = await Promise.all([request(a, route, body, 'PATCH'), request(a, route, { ...body, positions: body.positions.map(p => ({ ...p, x: p.x + 1 })) }, 'PATCH')])
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
  const saved = await read(); assert.ok(saved.every(row => row.v === '1'))
  const same = { ...body, positions: saved.map(row => ({ id: row.id, x: row.canvas_x, y: row.canvas_y, rotation: row.rotation, expected_version: row.v })) }
  await json(a, route, same, 'PATCH'); assert.deepEqual(await read(), saved)
  await json(a, route, { photo_ids: [first, second], components: [{ type: 'description', value: 'content only' }] }, 'PATCH')
  assert.ok((await read()).every(row => row.v === '1'))
  const beforeFailure = await read()
  await pool.query('ALTER TABLE journal_photos ADD CONSTRAINT batch_photo_failure CHECK (canvas_x <> 123456)')
  try {
    assert.equal((await request(a, route, { ...same, components: [{ type: 'description', value: 'must roll back' }], positions: same.positions.map((p, index) => ({ ...p, x: index ? 123456 : 99 })) }, 'PATCH')).status, 500)
    assert.deepEqual(await read(), beforeFailure)
  } finally { await pool.query('ALTER TABLE journal_photos DROP CHECK batch_photo_failure') }
  assert.equal((await request(a, route, { ...same, photo_ids: [first, foreignId], positions: [same.positions.find(p => p.id === first), { id: foreignId, x: 1, y: 1, expected_version: '0' }] }, 'PATCH')).status, 404)
  assert.deepEqual(await read(), beforeFailure)
  assert.equal((await request(a, route, { ...same, expected_structure_version: '18446744073709551615' }, 'PATCH')).status, 409)
  await json(a, route, { ...body, expected_structure_version: undefined, positions: body.positions.map(({ expected_version: _expectedVersion, ...position }) => ({ ...position, x: position.x + 9 })) }, 'PATCH')
  assert.ok((await read()).every(row => row.v === '2'))
  await json(a, '/api/journal/entries/' + entryA.id, undefined, 'DELETE')
  await json(a, '/api/journal/entries/' + entryB.id, undefined, 'DELETE')
  await json(b, '/api/journal/entries/' + foreign.id, undefined, 'DELETE')
})

test('nested group writes protect versions and roll back positions with group failures', async () => {
  const entryA = await photo(a), entryB = await photo(a)
  const photoId = async entry => (await pool.execute('SELECT id FROM journal_photos WHERE entry_id=?', [entry.id]))[0][0].id
  const first = await photoId(entryA), second = await photoId(entryB)
  const readStructure = async () => (await pool.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [a.id]))[0][0].v
  const readPhotos = async () => (await pool.execute('SELECT id,canvas_x,canvas_y,rotation,CAST(layout_version AS CHAR) AS v FROM journal_photos WHERE id IN (?,?) ORDER BY id', [first, second]))[0]
  const positions = rows => rows.map(row => ({ id: row.id, x: row.canvas_x, y: row.canvas_y, rotation: row.rotation, expected_version: row.v }))
  const one = await json(a, '/api/journal/groups', { name: 'inner one', positions: [{ id: first, x: 10, y: 20 }] })
  const two = await json(a, '/api/journal/groups', { name: 'inner two', positions: [{ id: second, x: 30, y: 40 }] })
  const structure = await readStructure(), initialPhotos = await readPhotos()
  const parent = await json(a, '/api/journal/groups', { name: 'outer', positions: positions(initialPhotos), expected_structure_version: structure })
  assert.equal(await readStructure(), String(BigInt(structure) + 1n)); assert.deepEqual(await readPhotos(), initialPhotos)
  assert.deepEqual(new Set(parent.child_group_ids), new Set([one.id, two.id]))
  const route = '/api/journal/groups/' + parent.id, current = await readStructure()
  assert.equal((await request(a, '/api/journal/groups', { name: 'partial', positions: positions(initialPhotos).slice(0, 1), expected_structure_version: current })).status, 400)
  assert.equal((await request(b, route, { collapsed: true }, 'PATCH')).status, 404)
  const body = { collapsed: true, positions: positions(initialPhotos).map(p => ({ ...p, x: p.x + 1 })), expected_structure_version: current }
  const race = await Promise.all([request(a, route, body, 'PATCH'), request(a, route, { ...body, positions: body.positions.map(p => ({ ...p, x: p.x + 1 })) }, 'PATCH')])
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
  assert.equal(await readStructure(), String(BigInt(current) + 1n))
  const saved = await readPhotos(); assert.ok(saved.every(row => row.v === '2'))
  const nextStructure = await readStructure()
  await json(a, route, { name: 'renamed', collapsed: true, expected_structure_version: nextStructure }, 'PATCH')
  assert.equal(await readStructure(), nextStructure)
  assert.equal((await request(a, route, { collapsed: false, positions: positions(initialPhotos), expected_structure_version: nextStructure }, 'PATCH')).status, 409)
  await pool.query("ALTER TABLE journal_canvas_groups ADD CONSTRAINT group_write_failure CHECK (name <> 'forced-group-failure')")
  try {
    assert.equal((await request(a, route, { name: 'forced-group-failure', collapsed: false, positions: positions(saved).map(p => ({ ...p, x: p.x + 10 })), expected_structure_version: nextStructure }, 'PATCH')).status, 500)
    assert.deepEqual(await readPhotos(), saved); assert.equal(await readStructure(), nextStructure)
    const [[group]] = await pool.execute('SELECT name,collapsed FROM journal_canvas_groups WHERE id=?', [parent.id]); assert.equal(group.name, 'renamed'); assert.equal(group.collapsed, 1)
  } finally { await pool.query('ALTER TABLE journal_canvas_groups DROP CHECK group_write_failure') }
  assert.equal((await request(a, '/api/journal/groups/' + one.id, { expected_structure_version: current }, 'DELETE')).status, 409)
  await json(a, '/api/journal/groups/' + one.id, { expected_structure_version: nextStructure }, 'DELETE')
  const [[membership]] = await pool.execute('SELECT group_id FROM journal_canvas_group_photos WHERE photo_id=?', [first]); assert.equal(membership.group_id, parent.id)
  assert.equal(await readStructure(), String(BigInt(nextStructure) + 1n))
  await json(a, route, undefined, 'DELETE'); await json(a, '/api/journal/groups/' + two.id, undefined, 'DELETE')
  await json(a, '/api/journal/entries/' + entryA.id, undefined, 'DELETE'); await json(a, '/api/journal/entries/' + entryB.id, undefined, 'DELETE')
})

test('entry and deletion writes enforce structure barriers and roll back cascades', async () => {
  const readStructure = async () => (await pool.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [a.id]))[0][0].v
  const initial = await readStructure()
  const textEntry = await json(a, '/api/journal/entries', { title: 'structure fixture', photos: [], expected_structure_version: initial })
  const current = await readStructure(); assert.equal(current, String(BigInt(initial) + 1n))
  await json(a, '/api/journal/entries/' + textEntry.id, { title: 'content only', photos: [], expected_structure_version: current }, 'PUT')
  assert.equal(await readStructure(), current)
  assert.equal((await request(a, '/api/journal/entries/' + textEntry.id, { title: 'stale', photos: [], expected_structure_version: initial }, 'PUT')).status, 409)
  const photoEntry = await photo(a)
  const [[picture]] = await pool.execute('SELECT id,url,CAST(layout_version AS CHAR) AS v FROM journal_photos WHERE entry_id=?', [photoEntry.id])
  const beforeEdit = await readStructure()
  await json(a, '/api/journal/entries/' + photoEntry.id, { title: 'kept photo', photos: [{ id: picture.id }], expected_structure_version: beforeEdit }, 'PUT')
  assert.equal(await readStructure(), beforeEdit)
  assert.equal((await pool.execute('SELECT CAST(layout_version AS CHAR) AS v FROM journal_photos WHERE id=?', [picture.id]))[0][0].v, picture.v)
  await json(a, '/api/journal/entries/' + photoEntry.id, { title: 'removed photo', photos: [], expected_structure_version: beforeEdit }, 'PUT')
  assert.equal(await readStructure(), String(BigInt(beforeEdit) + 1n))
  assert.equal((await pool.execute('SELECT id FROM journal_photos WHERE id=?', [picture.id]))[0].length, 0)
  await json(a, '/api/journal/entries/' + photoEntry.id, undefined, 'DELETE')
  await json(a, '/api/journal/entries/' + textEntry.id, undefined, 'DELETE')

  const notebook = await json(a, '/api/journal/notebooks', { name: 'membership fixture' })
  const [[page]] = await pool.execute('SELECT id FROM journal_notebook_pages WHERE notebook_id=? ORDER BY sort_order LIMIT 1', [notebook.id])
  const notebookEntry = await json(a, '/api/journal/entries', { title: 'page text', photos: [], notebook_page_id: page.id })
  const beforeUpload = await readStructure()
  const image = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#aacccc' } }).png().toBuffer()
  const form = new FormData()
  form.set('data', JSON.stringify({ title: 'now photos', photos: [{ upload_index: 0 }, { upload_index: 1 }], notebook_page_id: page.id, expected_structure_version: beforeUpload }))
  form.append('images', new Blob([image], { type: 'image/png' }), 'fixture.png')
  form.append('images', new Blob([image], { type: 'image/png' }), 'fixture-two.png')
  await json(a, '/api/journal/entries/' + notebookEntry.id, form, 'PUT')
  assert.equal(await readStructure(), String(BigInt(beforeUpload) + 1n), 'new photo and removed entry membership bump once')
  assert.equal((await pool.execute('SELECT id FROM journal_notebook_entry_items WHERE id=?', [notebookEntry.id]))[0].length, 0)
  assert.equal((await pool.execute('SELECT i.id FROM journal_notebook_photo_items i JOIN journal_photos p ON p.id=i.id WHERE p.entry_id=? AND i.page_id=?', [notebookEntry.id, page.id]))[0].length, 2)
  const [ordered] = await pool.execute('SELECT id,CAST(layout_version AS CHAR) AS v FROM journal_photos WHERE entry_id=? ORDER BY sort_order', [notebookEntry.id])
  const beforeReorder = await readStructure()
  await json(a, '/api/journal/entries/' + notebookEntry.id, { title: 'reordered', photos: [...ordered].reverse().map(p => ({ id: p.id })), expected_structure_version: beforeReorder }, 'PUT')
  assert.equal(await readStructure(), String(BigInt(beforeReorder) + 1n))
  const [reordered] = await pool.execute('SELECT id,CAST(layout_version AS CHAR) AS v FROM journal_photos WHERE entry_id=? ORDER BY sort_order', [notebookEntry.id])
  assert.deepEqual(reordered, [...ordered].reverse())
  await json(a, '/api/journal/entries/' + notebookEntry.id, undefined, 'DELETE')
  await json(a, '/api/journal/notebooks/' + notebook.id, undefined, 'DELETE')

  const racingEntry = await json(a, '/api/journal/entries', { title: 'delete race', photos: [] })
  const raceStructure = await readStructure()
  const raceRoute = '/api/journal/entries/' + racingEntry.id
  const deletionRace = await Promise.all([request(a, raceRoute, { expected_structure_version: raceStructure }, 'DELETE'), request(a, raceRoute, { expected_structure_version: raceStructure }, 'DELETE')])
  assert.deepEqual(deletionRace.map(r => r.status).sort(), [200, 409])
  assert.equal(await readStructure(), String(BigInt(raceStructure) + 1n))

  for (const mode of ['single-photo', 'batch-photos', 'entry', 'items']) {
    const entry = await photo(a)
    const [[p]] = await pool.execute('SELECT id,url FROM journal_photos WHERE entry_id=?', [entry.id])
    const structure = await readStructure()
    const route = mode === 'single-photo' ? '/api/journal/photos/' + p.id : mode === 'batch-photos' ? '/api/journal/photos' : mode === 'entry' ? '/api/journal/entries/' + entry.id : '/api/journal/items'
    const payload = mode === 'batch-photos' ? { photo_ids: [p.id] } : mode === 'items' ? { items: [{ kind: 'photo', id: p.id }] } : {}
    assert.equal((await request(a, route, { ...payload, expected_structure_version: '18446744073709551614' }, 'DELETE')).status, 409)
    assert.equal((await request(b, route, payload, 'DELETE')).status, 404)
    await pool.execute('UPDATE journal_layout_state SET structure_version=18446744073709551615 WHERE owner_id=?', [a.id])
    try {
      assert.equal((await request(a, route, { ...payload, expected_structure_version: '18446744073709551615' }, 'DELETE')).status, 409)
      assert.equal((await pool.execute('SELECT id FROM journal_entries WHERE id=?', [entry.id]))[0].length, 1)
      assert.equal((await pool.execute('SELECT id FROM journal_photos WHERE id=?', [p.id]))[0].length, 1)
      assert.ok((await readdir(uploadDirectory)).includes(path.basename(p.url)), 'failed deletion preserves file')
    } finally { await pool.execute('UPDATE journal_layout_state SET structure_version=? WHERE owner_id=?', [structure, a.id]) }
    await json(a, route, { ...payload, expected_structure_version: structure }, 'DELETE')
    assert.equal(await readStructure(), String(BigInt(structure) + 1n))
    assert.equal((await pool.execute('SELECT id FROM journal_entries WHERE id=?', [entry.id]))[0].length, 0)
    assert.equal((await pool.execute('SELECT id FROM journal_photos WHERE id=?', [p.id]))[0].length, 0)
  }
})

test('notebook membership and restore workers enforce structural barriers', async () => {
  const structure = async () => (await pool.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [a.id]))[0][0].v
  const book = await json(a, '/api/journal/notebooks', { name: 'structure book' })
  const [pages] = await pool.execute('SELECT id FROM journal_notebook_pages WHERE notebook_id=? ORDER BY sort_order', [book.id])
  const extra = await json(a, '/api/journal/notebooks/' + book.id + '/pages', {})
  const mark = await json(a, '/api/journal/marks', { kind: 'text', text: 'membership' })
  const item = { kind: 'mark', id: mark.id, x: 100, y: 100 }
  const attach = '/api/journal/notebook-pages/' + pages[0].id + '/items'
  let token = await structure()
  assert.equal((await request(a, attach, { items: [item], expected_structure_version: '18446744073709551614' })).status, 409)
  const race = await Promise.all([request(a, attach, { items: [item], expected_structure_version: token }), request(a, attach, { items: [item], expected_structure_version: token })])
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
  assert.equal(await structure(), String(BigInt(token) + 1n)); token = await structure()
  await json(a, '/api/journal/notebook-pages/' + extra.id + '/items', { items: [item], expected_structure_version: token })
  await json(a, '/api/journal/notebook-items', { items: [{ ...item, x: 200 }] }, 'PATCH')
  assert.equal(await structure(), token, 'page moves and page layout keep canvas membership')
  await json(a, '/api/journal/notebook-pages/' + extra.id, { expected_structure_version: token }, 'DELETE')
  assert.equal(await structure(), String(BigInt(token) + 1n)); token = await structure()
  await json(a, attach, { items: [item], expected_structure_version: token }); token = await structure()
  await json(a, '/api/journal/notebook-items', { items: [{ kind: 'mark', id: mark.id }], expected_structure_version: token }, 'DELETE')
  assert.equal(await structure(), String(BigInt(token) + 1n)); token = await structure()
  await json(a, attach, { items: [item] }); token = await structure()
  await pool.execute('UPDATE journal_layout_state SET structure_version=18446744073709551615 WHERE owner_id=?', [a.id])
  try {
    assert.equal((await request(a, '/api/journal/notebooks/' + book.id, { expected_structure_version: '18446744073709551615' }, 'DELETE')).status, 409)
    assert.equal((await pool.execute('SELECT id FROM journal_notebook_mark_items WHERE id=?', [mark.id]))[0].length, 1)
  } finally { await pool.execute('UPDATE journal_layout_state SET structure_version=? WHERE owner_id=?', [token, a.id]) }
  await json(a, '/api/journal/notebooks/' + book.id, { expected_structure_version: token }, 'DELETE')
  assert.equal(await structure(), String(BigInt(token) + 1n))
  await json(a, '/api/journal/marks/' + mark.id, undefined, 'DELETE')

  const archive = async (data, expected) => {
    const chunks = []; for await (const chunk of zipChunks([{ name: 'backup.json', data: Buffer.from(JSON.stringify({ format: 'shitu-journal-backup', version: 1, data })) }])) chunks.push(chunk)
    const form = new FormData(); form.set('backup', new Blob([Buffer.concat(chunks)], { type: 'application/zip' }), 'restore.zip')
    if (expected !== undefined) form.set('expected_structure_version', expected)
    return form
  }
  token = await structure()
  const emptyToken = (await pool.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [b.id]))[0][0].v
  await json(b, '/api/journal/restore', await archive({}, emptyToken))
  assert.equal((await pool.execute('SELECT CAST(structure_version AS CHAR) AS v FROM journal_layout_state WHERE owner_id=?', [b.id]))[0][0].v, emptyToken)
  assert.equal(await structure(), token)
  const restoredId = randomUUID(), data = { marks: [{ id: restoredId, kind: 'text', text: 'worker fixture', layout_version: '999', canvas_x: 1, canvas_y: 2 }] }
  const stale = await request(a, '/api/journal/restore', await archive(data, '18446744073709551614'))
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'LAYOUT_CONFLICT')
  assert.equal(await structure(), token)
  await json(a, '/api/journal/restore', await archive(data, token))
  assert.equal(await structure(), String(BigInt(token) + 1n)); token = await structure()
  const [[restored]] = await pool.execute("SELECT id,CAST(layout_version AS CHAR) AS v FROM journal_marks WHERE owner_id=? AND text='worker fixture'", [a.id])
  assert.notEqual(restored.id, restoredId); assert.equal(restored.v, '0')
  await pool.execute('UPDATE journal_layout_state SET structure_version=18446744073709551615 WHERE owner_id=?', [a.id])
  try {
    assert.equal((await request(a, '/api/journal/restore', await archive(data, '18446744073709551615'))).status, 409)
    assert.equal((await pool.execute("SELECT id FROM journal_marks WHERE owner_id=? AND text='worker fixture'", [a.id]))[0].length, 1)
  } finally { await pool.execute('UPDATE journal_layout_state SET structure_version=? WHERE owner_id=?', [token, a.id]) }
  await json(a, '/api/journal/marks/' + restored.id, undefined, 'DELETE')
})

test('runtime journal snapshot and layout routes enforce versions across legacy and conditional clients', async () => {
  const user = await account('runtime-layout@example.com')
  const first = await json(user, '/api/journal/marks', { kind: 'text', text: 'first runtime' })
  const second = await json(user, '/api/journal/marks', { kind: 'text', text: 'second runtime' })
  await pool.execute('UPDATE journal_marks SET layout_version=9007199254740995 WHERE id=?', [first.id])
  const snapshot = await json(user, '/api/journal')
  assert.equal(typeof snapshot.structure_version, 'string')
  assert.equal(snapshot.marks.find(m => m.id === first.id).layout_version, '9007199254740995')
  const item = (id, expected_version, x) => ({ kind: 'mark', id, expected_version, x, y: 20, rotation: 0 })
  const body = { expected_structure_version: snapshot.structure_version, items: [item(first.id, '9007199254740995', 10)] }
  const saved = await json(user, '/api/journal/layout', body, 'PATCH')
  assert.equal(saved.items[0].layout_version, '9007199254740996')
  assert.deepEqual(await json(user, '/api/journal/layout', body, 'PATCH'), saved, 'exact retry must not increment')
  const legacy = await json(user, '/api/journal/layout', { items: [{ kind: 'mark', id: first.id, x: 11, y: 20 }] }, 'PATCH')
  assert.equal(legacy.items[0].layout_version, '9007199254740997')
  const conflict = await request(user, '/api/journal/layout', { expected_structure_version: snapshot.structure_version, items: [item(second.id, '0', 99), item(first.id, '9007199254740996', 50)] }, 'PATCH')
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, 'LAYOUT_CONFLICT')
  assert.notEqual((await pool.execute('SELECT canvas_x FROM journal_marks WHERE id=?', [second.id]))[0][0].canvas_x, 99)
  const race = await Promise.all([request(user, '/api/journal/layout', { expected_structure_version: snapshot.structure_version, items: [item(second.id, '0', 30)] }, 'PATCH'), request(user, '/api/journal/layout', { expected_structure_version: snapshot.structure_version, items: [item(second.id, '0', 31)] }, 'PATCH')])
  assert.deepEqual(race.map(r => r.status).sort(), [200, 409])
  const trip = await json(user, '/api/journal/trips', { name: 'anchor change', expected_structure_version: snapshot.structure_version })
  const afterTrip = await json(user, '/api/journal')
  assert.equal(afterTrip.structure_version, String(BigInt(snapshot.structure_version) + 1n))
  assert.equal((await request(user, '/api/journal/layout', { expected_structure_version: snapshot.structure_version, items: [item(first.id, '9007199254740997', 40)] }, 'PATCH')).status, 409)
  assert.equal((await request(user, '/api/journal/trips', { name: 'stale anchor', expected_structure_version: snapshot.structure_version })).status, 409)
  await json(user, '/api/journal/trips/' + trip.id, { name: 'name only', color: 'rose' }, 'PATCH')
  assert.equal((await json(user, '/api/journal')).structure_version, afterTrip.structure_version)
  await pool.execute('UPDATE journal_layout_state SET structure_version=18446744073709551615 WHERE owner_id=?', [user.id])
  assert.equal((await request(user, '/api/journal/trips', { name: 'must roll back', expected_structure_version: '18446744073709551615' })).status, 409)
  assert.equal((await pool.execute('SELECT id FROM journal_trips WHERE owner_id=?', [user.id]))[0].length, 1)
})

test('layout coordinator retries an acknowledged-but-lost API result before newer intent', async () => {
  const user = await account('coordinator@example.com')
  const mark = await json(user, '/api/journal/marks', { kind: 'text', text: 'coordinator fixture' })
  const journal = await json(user, '/api/journal'), row = journal.marks.find(item => item.id === mark.id)
  const position = x => ({ kind: 'mark', id: mark.id, x, y: row.canvas_y, rotation: row.rotation })
  const bodies = []
  const controller = createLayoutPersistence({ baseline: { structure_version: journal.structure_version, items: [{ ...position(row.canvas_x), layout_version: row.layout_version }] }, send: async body => {
    bodies.push(body)
    const saved = await json(user, '/api/journal/layout', body, 'PATCH')
    if (bodies.length === 1) throw new Error('simulated lost acknowledgement after commit')
    return saved
  } })
  const until = async status => {
    const deadline = Date.now() + 5000
    while (controller.getSnapshot().status !== status && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(controller.getSnapshot().status, status)
  }
  try {
    controller.editLayout({ id: 'first', before: [position(row.canvas_x)], after: [position(10)] }); await until('failed')
    controller.editLayout({ id: 'second', before: [position(10)], after: [position(20)] })
    controller.retryLayout(); await until('saved')
    assert.equal(bodies.length, 3); assert.equal(bodies[0], bodies[1])
    assert.equal(bodies[2].items[0].expected_version, '1')
    const snapshot = await json(user, '/api/journal'), saved = snapshot.marks.find(item => item.id === mark.id)
    assert.equal(saved.canvas_x, 20); assert.equal(saved.layout_version, '2')
    assert.equal(controller.getSnapshot().items[0].x, 20)
  } finally { controller.dispose() }
})

test('two accounts: complete journal graph, private media, mixed writes and personal backup', async () => {
  const tripA = await json(a, '/api/journal/trips', { name: 'A private trip', owner_id: b.id })
  const tripB = await json(b, '/api/journal/trips', { name: 'B private trip' })
  const markA = await json(a, '/api/journal/marks', { kind: 'text', text: 'A private mark', owner_id: b.id })
  const markB = await json(b, '/api/journal/marks', { kind: 'text', text: 'B private mark' })
  const entryA = await photo(a), entryB = await photo(b)
  const notebookA = await json(a, '/api/journal/notebooks', { name: 'A book' })
  const notebookB = await json(b, '/api/journal/notebooks', { name: 'B book' })
  let journalA = await json(a, '/api/journal'), journalB = await json(b, '/api/journal')
  const pa = journalA.entries.find(e => e.id === entryA.id).photos[0], pb = journalB.entries.find(e => e.id === entryB.id).photos[0]
  const pageA = journalA.notebook_pages.find(p => p.notebook_id === notebookA.id), pageB = journalB.notebook_pages.find(p => p.notebook_id === notebookB.id)
  assert.ok(journalA.trips.some(t => t.id === tripA.id))
  assert.ok(!journalA.trips.some(t => t.id === tripB.id))
  assert.ok(!journalA.entries.some(e => e.id === entryB.id))
  assert.ok(!journalA.notebooks.some(n => n.id === notebookB.id))
  const [[owner]] = await pool.execute('SELECT owner_id FROM journal_trips WHERE id=?', [tripA.id]); assert.equal(owner.owner_id, a.id)
  assert.equal((await request(null, '/api/journal')).status, 401)
  assert.equal((await request(null, pa.url)).status, 401)
  assert.equal((await request(b, pa.url)).status, 404)
  const media = await request(a, pa.url); assert.equal(media.status, 200); assert.match(media.headers.get('cache-control'), /no-store/)
  assert.equal((await sharp(Buffer.from(await media.arrayBuffer())).metadata()).exif, undefined)
  assert.equal((await request(null, pa.url + '?thumbnail=1')).status, 401)
  assert.equal((await request(b, pa.url + '?thumbnail=1')).status, 404)
  const thumbnail = await request(a, pa.url + '?thumbnail=1')
  assert.equal(thumbnail.status, 200)
  assert.match(thumbnail.headers.get('content-type'), /image\/webp/)
  assert.match(thumbnail.headers.get('cache-control'), /no-store/)
  assert.equal((await sharp(Buffer.from(await thumbnail.arrayBuffer())).metadata()).format, 'webp')
  assert.equal((await request(b, pa.url + '?thumbnail=1')).status, 404, 'cached thumbnails still require ownership')
  assert.equal((await request(a, '/api/journal/trips/' + tripB.id, { name: 'stolen' }, 'PATCH')).status, 404)
  assert.equal((await request(a, '/api/journal/entries/' + entryB.id, undefined, 'DELETE')).status, 404)
  assert.equal((await request(a, '/api/journal/layout', { items: [{ kind: 'mark', id: markA.id, x: 900, y: 900 }, { kind: 'mark', id: markB.id, x: 900, y: 900 }] }, 'PATCH')).status, 404)
  const [[position]] = await pool.execute('SELECT canvas_x FROM journal_marks WHERE id=?', [markA.id]); assert.notEqual(position.canvas_x, 900)
  assert.equal((await request(a, '/api/journal/photos', { photo_ids: [pa.id, pb.id] }, 'DELETE')).status, 404)
  assert.ok((await json(a, '/api/journal')).entries.some(e => e.id === entryA.id))
  const mixed = await request(a, '/api/journal/groups', { name: 'mixed', positions: [{ id: pa.id, x: 0, y: 0 }, { id: pb.id, x: 1, y: 1 }] }); assert.equal(mixed.status, 404)
  assert.equal((await request(a, '/api/journal/notebook-pages/' + pageB.id + '/items', { items: [{ kind: 'photo', id: pa.id, x: 100, y: 100 }] })).status, 404)
  assert.equal((await request(a, '/api/journal/notebook-pages/' + pageA.id + '/items', { items: [{ kind: 'photo', id: pb.id, x: 100, y: 100 }] })).status, 404)
  await json(a, '/api/journal/notebook-pages/' + pageA.id + '/items', { items: [{ kind: 'photo', id: pa.id, x: 100, y: 100 }] })
  assert.equal((await request(b, '/api/journal/notebook-items', { items: [{ kind: 'photo', id: pa.id }] }, 'DELETE')).status, 404)
  assert.equal((await request(a, '/api/journal/notebooks/' + notebookA.id, { cover_url: pb.url, cover_mode: 'photo' }, 'PATCH')).status, 404)
  assert.equal((await request(a, '/api/journal/notebooks/' + notebookA.id + '/reading', { bookmark_page_id: pageB.id }, 'PATCH')).status, 400)
  const badTrip = await request(a, '/api/journal/entries', { caption: 'foreign trip', photos: [], trip_id: tripB.id }); assert.equal(badTrip.status, 400)
  const component = await request(a, '/api/journal/photos/components', { photo_ids: [pa.id], components: [{ type: 'trip', value: tripB.id }] }, 'PATCH'); assert.equal(component.status, 400)
  const backup = await request(a, '/api/journal/backup'); assert.equal(backup.status, 200)
  const archive = Buffer.from(await backup.arrayBuffer()), files = readZip(archive)
  const manifest = JSON.parse(files.get('backup.json'))
  for (const table of ['entries', 'photos', 'marks']) assert.ok(manifest.data[table].every(row => !Object.hasOwn(row, 'layout_version')))
  assert.equal(Object.hasOwn(manifest.data, 'structure_version'), false)
  assert.deepEqual(manifest.data.entries.map(e => e.id), [entryA.id])
  assert.ok(!manifest.data.trips.some(t => t.id === tripB.id))
  // A user can import a portable backup, but ownership and IDs are assigned anew.
  manifest.data.trips.forEach(t => { t.owner_id = a.id })
  const portable = new FormData(); portable.append('backup', new Blob([archive], { type: 'application/zip' }), 'backup.zip')
  await json(b, '/api/journal/restore', portable)
  journalB = await json(b, '/api/journal')
  assert.equal(journalB.entries.length, 2)
  assert.ok(!journalB.entries.some(e => e.id === entryA.id))
  assert.ok(!journalB.notebook_pages.some(p => p.id === pageA.id))
  const [[foreign]] = await pool.execute('SELECT COUNT(*) AS total FROM journal_entries WHERE owner_id=?', [a.id]); assert.equal(Number(foreign.total), 1)
  manifest.data.notebook_pages[0].notebook_id = notebookB.id
  const chunks = []; for await (const chunk of zipChunks([{ name: 'backup.json', data: Buffer.from(JSON.stringify(manifest)) }, ...[...files].filter(([name]) => name !== 'backup.json').map(([name, data]) => ({ name, data }))])) chunks.push(chunk)
  const malformed = new FormData(); malformed.append('backup', new Blob(chunks, { type: 'application/zip' }), 'bad.zip')
  assert.equal((await request(b, '/api/journal/restore', malformed)).status, 400)
  assert.equal((await json(b, '/api/journal')).entries.length, 2)
})

test('unverified uploads, CSRF and image decoding fail before creating private data', async () => {
  assert.equal((await request(unverified, '/api/journal/entries', { caption: 'not yet', photos: [] })).status, 403)
  const csrf = await fetch(base + '/api/journal/trips', { method: 'POST', headers: { Cookie: a.cookie, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'csrf' }) }); assert.equal(csrf.status, 403)
  const before = (await readdir(uploadDirectory)).sort()
  const bad = new FormData(); bad.set('data', JSON.stringify({ photos: [{ upload_index: 0 }] })); bad.append('images', new Blob(['spoofed image'], { type: 'image/png' }), 'fake.png')
  assert.equal((await request(a, '/api/journal/entries', bad)).status, 400)
  assert.deepEqual((await readdir(uploadDirectory)).sort(), before)
})

test('logout invalidates server-side session including private media', async () => {
  await json(unverified, '/api/auth/logout', {})
  assert.equal((await request(unverified, '/api/journal')).status, 401)
  const session = await json(unverified, '/api/auth/session'); assert.equal(session.user, null)
})

async function cover(user) {
  const image = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#ccaaaa' } }).png().toBuffer()
  const form = new FormData()
  form.append('image', new Blob([image], { type: 'image/png' }), 'cover.png')
  return (await json(user, '/api/journal/notebook-covers', form)).url
}

test('cover replacement and last notebook deletion reclaim files and quota without deleting shared covers', async () => {
  const user = await account('lifecycle@example.com'), first = await cover(user), second = await cover(user)
  const one = await json(user, '/api/journal/notebooks', { name: 'one', cover_url: first })
  const two = await json(user, '/api/journal/notebooks', { name: 'two', cover_url: first })
  await json(user, '/api/journal/notebooks/' + one.id, { cover_url: second }, 'PATCH')
  assert.equal((await request(user, first)).status, 200)
  assert.equal((await request(b, '/api/journal/notebooks/' + two.id, undefined, 'DELETE')).status, 404)
  await json(user, '/api/journal/notebooks/' + two.id, undefined, 'DELETE')
  assert.equal((await request(user, first)).status, 404)
  await assert.rejects(stat(path.join(uploadDirectory, path.basename(first))), { code: 'ENOENT' })
  const [[remaining]] = await pool.execute('SELECT COUNT(*) AS total FROM assets WHERE owner_id=?', [user.id])
  assert.equal(Number(remaining.total), 1)
  await json(user, '/api/journal/notebooks/' + one.id, undefined, 'DELETE')
  const [[usage]] = await pool.execute('SELECT COALESCE(SUM(bytes),0) AS bytes FROM assets WHERE owner_id=?', [user.id])
  assert.equal(Number(usage.bytes), 0)
})

test('a cover also referenced by a photo survives discarding and notebook deletion until its last photo is removed', async () => {
  const user = await account('shared-photo@example.com'), url = await cover(user)
  const book = await json(user, '/api/journal/notebooks', { name: 'shared', cover_url: url })
  const entry = await photo(user)
  const journal = await json(user, '/api/journal'), oldPhoto = journal.entries.find(e => e.id === entry.id).photos[0]
  await pool.execute('UPDATE journal_photos SET url=? WHERE id=?', [url, oldPhoto.id])
  await json(user, '/api/journal/notebooks/' + book.id, undefined, 'DELETE')
  assert.equal((await request(user, '/api/journal/notebook-covers?url=' + encodeURIComponent(url), undefined, 'DELETE')).status, 409)
  assert.equal((await request(user, url)).status, 200)
  await json(user, '/api/journal/photos/' + oldPhoto.id, undefined, 'DELETE')
  assert.equal((await request(user, url)).status, 404)
  await assert.rejects(stat(path.join(uploadDirectory, path.basename(url))), { code: 'ENOENT' })
})

test('maintenance preserves fresh uploads and references, supports dry run and retries a failed disk delete', async () => {
  const user = await account('maintenance@example.com'), fresh = await cover(user), orphan = await cover(user), shared = await cover(user)
  await json(user, '/api/journal/notebooks', { name: 'retained', cover_url: shared })
  await pool.execute('UPDATE assets SET created_at=DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE storage_key IN (?,?)', [path.basename(orphan), path.basename(shared)])
  assert.deepEqual(await collectUnusedAssets(uploadDirectory, { ownerId: user.id, dryRun: true }), { deleted: 1, retained: 1 })
  assert.equal((await request(user, orphan)).status, 200)
  // A missing mount directory fails after the durable deletion marker commits.
  const savedDirectory = uploadDirectory + '-temporarily-unavailable'
  await rename(uploadDirectory, savedDirectory)
  try {
    // Simulate EISDIR without permissions/platform-specific chmod semantics.
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path.join(uploadDirectory, path.basename(orphan)), { recursive: true })
    await assert.rejects(collectUnusedAssets(uploadDirectory, { ownerId: user.id }))
  } finally {
    const { rm } = await import('node:fs/promises')
    await rm(uploadDirectory, { recursive: true, force: true })
    await rename(savedDirectory, uploadDirectory)
  }
  assert.equal((await request(user, orphan)).status, 404)
  assert.deepEqual(await collectUnusedAssets(uploadDirectory, { ownerId: user.id }), { deleted: 1, retained: 1 })
  assert.equal((await request(user, fresh)).status, 200)
  assert.equal((await request(user, shared)).status, 200)
  await assert.rejects(stat(path.join(uploadDirectory, path.basename(orphan))), { code: 'ENOENT' })
})

test('a backup over 64MiB streams as one ZIP, restores fully and rolls back a corrupted final image', async () => {
  const user = await account('large-backup@example.com')
  const image = await sharp(randomBytes(2048 * 1536 * 3), { raw: { width: 2048, height: 1536, channels: 3 } }).png().toBuffer()
  const form = new FormData(); form.set('data', JSON.stringify({ photos: [{ upload_index: 0 }] }))
  form.append('images', new Blob([image], { type: 'image/png' }), 'noise.png')
  const entry = await json(user, '/api/journal/entries', form)
  const journal = await json(user, '/api/journal'), original = journal.entries.find(e => e.id === entry.id).photos[0]
  const originalPath = path.join(uploadDirectory, path.basename(original.url)), bytes = (await stat(originalPath)).size
  for (let i = 0; i < 7; i++) {
    const key = randomUUID() + '.png'
    await copyFile(originalPath, path.join(uploadDirectory, key))
    await pool.execute('INSERT INTO assets (storage_key,owner_id,bytes,mime) VALUES (?,?,?,?)', [key, user.id, bytes, 'image/png'])
    await pool.execute('INSERT INTO journal_photos (id,entry_id,url) VALUES (?,?,?)', [randomUUID(), entry.id, '/uploads/' + key])
  }
  const response = await request(user, '/api/journal/backup')
  assert.equal(response.status, 200)
  const target = path.join(uploadDirectory, 'large-roundtrip-test.zip')
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target))
  assert.ok((await stat(target)).size > 64 * 1024 * 1024)
  const restoreForm = new FormData(); restoreForm.append('backup', await openAsBlob(target), 'large.zip')
  const restoring = request(user, '/api/journal/restore', restoreForm)
  const deadline = Date.now() + 15000
  while (!metricsSnapshot().restore_active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  assert.ok(metricsSnapshot().restore_active > 0, 'Large restore runs in a tracked background thread')
  assert.equal((await fetch(base + '/api/health', { signal: AbortSignal.timeout(2000) })).status, 200)
  const restoredResponse = await restoring
  assert.equal(restoredResponse.status, 200)
  const restored = await restoredResponse.json()
  assert.equal(restored.restored.photos, 8)
  assert.equal((await json(user, '/api/journal')).entries.length, 2)
  const before = (await readdir(uploadDirectory)).sort()
  const handle = await open(target, 'r+'), footer = Buffer.alloc(22), length = (await handle.stat()).size
  await handle.read(footer, 0, 22, length - 22)
  const finalByte = footer.readUInt32LE(16) - 1, damaged = Buffer.alloc(1)
  await handle.read(damaged, 0, 1, finalByte); damaged[0] ^= 0xff
  await handle.write(damaged, 0, 1, finalByte); await handle.close()
  const bad = new FormData(); bad.append('backup', await openAsBlob(target), 'corrupt.zip')
  assert.equal((await request(user, '/api/journal/restore', bad)).status, 400)
  assert.equal((await json(user, '/api/journal')).entries.length, 2)
  assert.deepEqual((await readdir(uploadDirectory)).sort(), before)
})

test('concurrent attachment and collection never leave a notebook with a deleted cover', async () => {
  const user = await account('concurrent-cover@example.com')
  for (let i = 0; i < 3; i++) {
    const url = await cover(user)
    const [, response] = await Promise.all([
      collectUnusedAssets(uploadDirectory, { ownerId: user.id, urls: [url] }),
      request(user, '/api/journal/notebooks', { name: 'concurrent-' + i, cover_url: url }),
    ])
    assert.ok([201, 404].includes(response.status))
    assert.equal((await request(user, url)).status, response.status === 201 ? 200 : 404)
  }
})

test('restore exceeding remaining quota rolls back assets, journal rows and new files', async () => {
  const user = await account('full-storage@example.com'), url = await cover(user)
  await pool.execute('UPDATE assets SET bytes=? WHERE storage_key=?', [512 * 1024 * 1024, path.basename(url)])
  const backup = await request(a, '/api/journal/backup'), body = Buffer.from(await backup.arrayBuffer())
  const before = (await readdir(uploadDirectory)).sort()
  const form = new FormData(); form.append('backup', new Blob([body]), 'backup.zip')
  assert.equal((await request(user, '/api/journal/restore', form)).status, 413)
  assert.equal((await json(user, '/api/journal')).entries.length, 0)
  const [[count]] = await pool.execute('SELECT COUNT(*) AS total FROM assets WHERE owner_id=?', [user.id])
  assert.equal(Number(count.total), 1)
  assert.deepEqual((await readdir(uploadDirectory)).sort(), before)
})

test('backup preflight does not consume the five actual download slots', async () => {
  const user = await account('download-rate@example.com')
  for (let i = 0; i < 5; i++) {
    assert.equal((await request(user, '/api/journal/backup', undefined, 'HEAD')).status, 200)
    const download = await request(user, '/api/journal/backup')
    assert.equal(download.status, 200)
    await download.arrayBuffer()
  }
  assert.equal((await request(user, '/api/journal/backup')).status, 429)
})

test('independent rate limiter instances share an atomic account budget and expiry in MySQL', async () => {
  const { sharedRateLimit } = await import('./shared-rate-limit.js')
  const { default: express } = await import('express')
  const limiterApp = express(), scope = 'integration-' + randomUUID()
  const options = { scope, max: 3, windowMs: 60000, key: req => req.get('X-Test-Key') }
  limiterApp.get('/one', sharedRateLimit(options), (_req, res) => res.json({ ok: true }))
  limiterApp.get('/two', sharedRateLimit(options), (_req, res) => res.json({ ok: true }))
  limiterApp.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const listener = limiterApp.listen(0, '127.0.0.1')
  await new Promise(resolve => listener.once('listening', resolve))
  const address = `http://127.0.0.1:${listener.address().port}`
  try {
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => fetch(address + (i % 2 ? '/one' : '/two'), { headers: { 'X-Test-Key': 'a' } })))
    assert.equal(results.filter(response => response.status === 200).length, 3)
    assert.equal(results.filter(response => response.status === 429).length, 5)
    assert.equal((await fetch(address + '/two', { headers: { 'X-Test-Key': 'b' } })).status, 200)
    await pool.execute('UPDATE rate_limits SET expires_at=DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE scope=?', [scope])
    assert.equal((await fetch(address + '/one', { headers: { 'X-Test-Key': 'a' } })).status, 200)
  } finally { await new Promise(resolve => listener.close(resolve)) }
})

test('restore admission is shared across instances, limits each owner, and releases slots', async () => {
  const { acquireRestoreSlot } = await import('./restore-runner.js')
  const first = await acquireRestoreSlot(a.id), second = await acquireRestoreSlot(b.id)
  try {
    await assert.rejects(acquireRestoreSlot(a.id), { status: 429 })
    await assert.rejects(acquireRestoreSlot(unverified.id), { status: 429 })
    await first()
    const available = await acquireRestoreSlot(unverified.id)
    await available()
  } finally { await first(); await second() }
})

test('notebook mutations no longer wait on a global cross-account cover lock', async () => {
  const blocker = await pool.getConnection()
  await blocker.query("SELECT GET_LOCK('shitu-notebook-covers',0)")
  try {
    const response = await fetch(base + '/api/journal/notebooks', { method: 'POST', signal: AbortSignal.timeout(1500), headers: { Cookie: b.cookie, Origin: origin, 'X-CSRF-Token': b.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'independent account' }) })
    assert.equal(response.status, 201)
  } finally { await blocker.query("SELECT RELEASE_LOCK('shitu-notebook-covers')"); blocker.release() }
})

test('maintenance removes expired credentials and stale temporary files while protected operations report capacity', async () => {
  const token = process.env.OPERATIONS_TOKEN
  assert.equal((await fetch(base + '/api/operations/status')).status, 401)
  const old = new Date(Date.now() - 2 * 86400000), temporary = 'restore-' + randomUUID() + '.zip'
  const target = path.join(uploadDirectory, temporary), unknown = path.join(uploadDirectory, 'operator-unknown.txt')
  await writeFile(target, 'stale'); await utimes(target, old, old)
  await writeFile(unknown, 'keep'); await utimes(unknown, old, old)
  const expiredHash = randomBytes(32).toString('hex')
  await pool.execute('INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES (?,?,?,?)', [expiredHash, a.id, randomBytes(32).toString('hex'), old])
  await pool.execute('INSERT INTO auth_tokens (id,user_id,token_hash,purpose,expires_at) VALUES (?,?,?,?,?)', [randomUUID(), a.id, randomBytes(32).toString('hex'), 'verify', old])
  await runMaintenance({ uploadDirectory, dryRun: true })
  assert.ok(await stat(target))
  const result = await runMaintenance({ uploadDirectory })
  assert.ok(result.expired.sessions >= 1 && result.expired.auth_tokens >= 1)
  await assert.rejects(stat(target), { code: 'ENOENT' })
  assert.ok(await stat(unknown))
  const response = await fetch(base + '/api/operations/status', { headers: { Authorization: 'Bearer ' + token } })
  assert.equal(response.status, 200)
  const status = await response.json()
  assert.ok(status.nearCapacityAccounts > 0)
  assert.ok(status.warnings.includes('accounts_near_capacity'))
  assert.ok(!JSON.stringify(status).includes('example.com'))
})

test('maintenance preserves both registered and unregistered images still referenced by retired guides and checkins', async () => {
  const user = await account('legacy-retention@example.com'), url = await cover(user)
  await pool.execute('UPDATE assets SET created_at=DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE storage_key=?', [path.basename(url)])
  await pool.execute('INSERT INTO guides (title,cover_image_url,landmark_ids) VALUES (?,?,?)', ['archived guide', url, '[]'])
  const key = 'restore-photo-' + randomUUID() + '.png', target = path.join(uploadDirectory, key)
  await writeFile(target, 'legacy image preserved for system recovery')
  const old = new Date(Date.now() - 2 * 86400000); await utimes(target, old, old)
  await pool.execute('INSERT INTO checkins (lat,lng,image_url) VALUES (?,?,?)', [30, 120, '/uploads/' + key])
  await runMaintenance({ uploadDirectory })
  assert.equal((await request(user, url)).status, 200)
  assert.ok(await stat(target))
})
