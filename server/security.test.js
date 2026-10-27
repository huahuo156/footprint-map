import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import argon2 from 'argon2'
import sharp from 'sharp'
import { app, uploadDirectory } from './app.js'
import { pool } from './db.js'
import { readZip, zipChunks } from './zip.js'

if (!/^footprint_security_test_[a-f0-9]{12}$/.test(process.env.MYSQL_DATABASE || '') || process.env.MYSQL_DATABASE !== process.env.SECURITY_TEST_DATABASE) throw new Error('Use npm run test:api: isolated disposable database required')
const origin = process.env.APP_ORIGIN
let server, base, a, b, unverified
async function account(email, verified = true) {
  const id = randomUUID(), password = 'security-test-password-123'
  await pool.execute('INSERT INTO users (id,email,password_hash,email_verified_at) VALUES (?,?,?,?)', [id, email, await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }), verified ? new Date() : null])
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
