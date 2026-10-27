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
import { readZip, zipChunks } from './zip.js'
import { collectUnusedAssets } from './asset-lifecycle.js'
import { metricsSnapshot } from './telemetry.js'
import { runMaintenance } from './operations.js'

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
