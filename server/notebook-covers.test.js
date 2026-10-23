import express from 'express'
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createJournalRouter } from './journal.js'
import { initializeDatabase, pool } from './db.js'
let server, base, directory
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
async function api(route, body, method = 'POST') {
 const options = { method, headers: { 'Content-Type': 'application/json' } }
 if (method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body)
 const res = await fetch(base + route, options)
 return { status: res.status, data: await res.json() }
}
async function upload(bytes = png, type = 'image/png', field = 'image') {
 const form = new FormData(); form.append(field, new Blob([bytes], { type }), 'cover.png')
 const res = await fetch(base + '/notebook-covers', { method: 'POST', body: form })
 return { status: res.status, data: await res.json() }
}
before(async () => {
 assert.match(process.env.MYSQL_DATABASE || '', /test/i, 'Cover migration tests require an isolated test database')
 assert.equal(process.env.MYSQL_PORT, '3308', 'Cover migration tests only run against the isolated 3308 instance')
 await initializeDatabase()
 directory = await mkdtemp(path.join(tmpdir(), 'notebook-covers-'))
 const app = express(); app.use(express.json()); app.use(createJournalRouter(directory))
 app.use((error, _req, res, _next) => res.status(error.code?.startsWith('LIMIT_') ? 400 : error.status || 500).json({ error: error.message }))
 server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
 base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
 if(server) await new Promise(resolve => server.close(resolve))
 if(directory) await rm(directory, { recursive: true, force: true })
 await pool.end()
})
test('dedicated cover uploads validate signature, MIME, size and field without leaving files', async () => {
 for(const [bytes, type, field] of [[Buffer.from('fake'), 'image/png', 'image'], [png, 'image/jpeg', 'image'], [png, 'text/plain', 'image'], [png, 'image/png', 'photos'], [Buffer.alloc(10*1024*1024+1), 'image/png', 'image']]) {
  assert.equal((await upload(bytes, type, field)).status, 400)
 }
 assert.deepEqual(await readdir(directory), [])
 for(const [bytes,type,ext] of [[png,'image/png','png'],[Buffer.from([255,216,255,224]),'image/jpeg','jpg'],[Buffer.from('RIFFxxxxWEBPxxxx'),'image/webp','webp']]) {
  const result = await upload(bytes,type)
  assert.equal(result.status,201)
  assert.match(result.data.url,new RegExp('^/uploads/cover-[a-f0-9-]{36}\\.'+ext+'$'))
  assert.equal((await api('/notebook-covers?url='+encodeURIComponent(result.data.url),{},'DELETE')).status,200)
 }
})
test('cover persistence protects referenced files and does not create or delete source photos', async () => {
 const [[before]] = await pool.query('SELECT (SELECT COUNT(*) FROM journal_entries) AS entries, (SELECT COUNT(*) FROM journal_photos) AS photos')
 const result = await upload(); assert.equal(result.status,201)
 const url = result.data.url
 const created = await api('/notebooks',{name:'uploaded cover',cover_url:url,cover_mode:'photo',cover_color:'#AABBCC',cover_label:''})
 assert.equal(created.status,201)
 try {
  assert.equal((await api('/notebook-covers?url='+encodeURIComponent(url),{},'DELETE')).status,409)
  await access(path.join(directory,path.basename(url)))
  assert.equal((await api('/notebooks/'+created.data.id,{cover_mode:'text',cover_color:'#112233',cover_url:null},'PATCH')).status,200)
  assert.equal((await api('/notebook-covers?url='+encodeURIComponent(url),{},'DELETE')).status,200)
  assert.equal((await api('/notebooks',{name:'missing',cover_url:url})).status,400)
  assert.equal((await api('/notebook-covers?url=/uploads/unrelated.png',{},'DELETE')).status,400)
  assert.equal((await api('/notebook-covers?url=/uploads/../secret',{},'DELETE')).status,400)
  const abandoned = await upload()
  assert.equal((await api('/notebooks',{name:'invalid',cover_url:abandoned.data.url,cover_mode:'bad'})).status,400)
  assert.equal((await api('/notebook-covers?url='+encodeURIComponent(abandoned.data.url),{},'DELETE')).status,200)
  const [[now]] = await pool.query('SELECT (SELECT COUNT(*) FROM journal_entries) AS entries, (SELECT COUNT(*) FROM journal_photos) AS photos')
  assert.deepEqual(now,before)
 } finally { await api('/notebooks/'+created.data.id,{},'DELETE') }
})
test('migration derives old photo and solid covers and preserves later style edits across restart', async () => {
 await pool.query('ALTER TABLE journal_notebooks DROP COLUMN cover_mode, DROP COLUMN cover_color')
 const ids = ['11111111-1111-4111-a111-111111111111','22222222-2222-4222-a222-222222222222']
 try {
  await pool.execute('INSERT INTO journal_notebooks(id,name,cover_url,cover_label,cover_text) VALUES (?,?,?,?,?),(?,?,?,?,?)',[ids[0],'old photo','/journal-demo/lake.jpg','','note',ids[1],'old solid',null,'MEMO',''])
  await initializeDatabase()
  const [rows] = await pool.query('SELECT cover_mode,cover_color,cover_url,cover_label,cover_text FROM journal_notebooks WHERE id IN (?,?) ORDER BY id', ids)
  assert.deepEqual(rows.map(r=>r.cover_mode),['photo','solid'])
  assert.equal(rows[0].cover_color,'#e3e9dd'); assert.equal(rows[0].cover_label,''); assert.equal(rows[0].cover_text,'note'); assert.equal(rows[0].cover_url,'/journal-demo/lake.jpg')
  assert.equal((await api('/notebooks/'+ids[0],{cover_mode:'text',cover_color:'#123456'},'PATCH')).status,200)
  await initializeDatabase()
  const [[row]] = await pool.execute('SELECT cover_mode,cover_color FROM journal_notebooks WHERE id=?',[ids[0]])
  assert.deepEqual(row,{cover_mode:'text',cover_color:'#123456'})
 } finally { await pool.query('DELETE FROM journal_notebooks WHERE id IN (?,?)',ids) }
})
test('failed notebook transaction leaves no notebook/pages and its cover can be discarded safely', async () => {
 const uploaded = await upload()
 const [[before]] = await pool.query('SELECT (SELECT COUNT(*) FROM journal_notebooks) AS books, (SELECT COUNT(*) FROM journal_notebook_pages) AS pages')
 await pool.query("CREATE TRIGGER cover_test_page_failure BEFORE INSERT ON journal_notebook_pages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='simulated save failure'")
 try {
  const saved = await api('/notebooks',{name:'rollback',cover_url:uploaded.data.url,cover_mode:'photo'})
  assert.equal(saved.status,500)
  const [[now]] = await pool.query('SELECT (SELECT COUNT(*) FROM journal_notebooks) AS books, (SELECT COUNT(*) FROM journal_notebook_pages) AS pages')
  assert.deepEqual(now,before)
  assert.equal((await api('/notebook-covers?url='+encodeURIComponent(uploaded.data.url),{},'DELETE')).status,200)
  await assert.rejects(access(path.join(directory,path.basename(uploaded.data.url))), { code: 'ENOENT' })
 } finally { await pool.query('DROP TRIGGER cover_test_page_failure') }
})
