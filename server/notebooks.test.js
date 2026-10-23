import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { app } from './app.js'
import { initializeDatabase, pool } from './db.js'
let server, base
const books = [],
  marks = [],
  entries = []
async function api(route, body, method = 'POST') {
  const response = await fetch(
    base + route,
    body === undefined
      ? {}
      : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  return { status: response.status, data: await response.json().catch(() => null) }
}
before(async () => {
  await initializeDatabase()
  server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${server.address().port}/api/journal`
})
after(async () => {
  for (const id of books) await api('/notebooks/' + id, {}, 'DELETE')
  for (const id of marks) await api('/marks/' + id, {}, 'DELETE')
  for (const id of entries) await api('/entries/' + id, {}, 'DELETE')
  if (server) await new Promise((r) => server.close(r))
  await pool.end()
})
test('reading position and a single bookmark persist by page ID and reject foreign pages', async () => {
  const created = await api('/notebooks', { name: 'reading state' }), other = await api('/notebooks', { name: 'other book' })
  books.push(created.data.id, other.data.id)
  const journal = (await api('')).data
  const pages = journal.notebook_pages.filter(p => p.notebook_id === created.data.id)
  const foreign = journal.notebook_pages.find(p => p.notebook_id === other.data.id)
  const route = '/notebooks/' + created.data.id + '/reading'
  const values = { bookmark_page_id: pages[2].id, last_read_page_id: pages[2].id }
  assert.equal((await api(route, values, 'PATCH')).status, 200)
  await initializeDatabase()
  let stored = (await api('')).data.notebooks.find(b => b.id === created.data.id)
  assert.equal(stored.bookmark_page_id, pages[2].id)
  assert.equal(stored.last_read_page_id, pages[2].id)
  assert.equal((await api(route, { bookmark_page_id: foreign.id, last_read_page_id: pages[0].id }, 'PATCH')).status, 400)
  for (const invalid of [{}, { last_read_page_id: 2 }, { bookmark_page_id: randomUUID() }, { last_read_page_id: '' }, { name: 'invalid' }]) assert.equal((await api(route, invalid, 'PATCH')).status, 400)
  assert.equal((await api('/notebooks/' + randomUUID() + '/reading', {last_read_page_id:null}, 'PATCH')).status,404)
  stored = (await api('')).data.notebooks.find(b => b.id === created.data.id)
  assert.equal(stored.last_read_page_id, pages[2].id)
  await api('/notebooks/' + created.data.id + '/pages', {page_ids:pages.map(p=>p.id).reverse()}, 'PATCH')
  assert.equal((await api('')).data.notebooks.find(b => b.id === created.data.id).bookmark_page_id, pages[2].id)
  await api('/notebook-pages/' + pages[2].id, {}, 'DELETE')
  stored = (await api('')).data.notebooks.find(b => b.id === created.data.id)
  assert.equal(stored.bookmark_page_id,null)
  assert.equal(stored.last_read_page_id,null)
  await api(route, {bookmark_page_id:pages[0].id,last_read_page_id:pages[0].id}, 'PATCH')
  await api(route, {bookmark_page_id:null,last_read_page_id:null}, 'PATCH')
  stored = (await api('')).data.notebooks.find(b => b.id === created.data.id)
  assert.equal(stored.bookmark_page_id,null)
  assert.equal(stored.last_read_page_id,null)
})

test('notebook cover metadata persists through create, patch, read and repeated initialization', async () => {
  const created = await api('/notebooks', { name: 'cover metadata' })
  assert.equal(created.status, 201)
  books.push(created.data.id)
  assert.equal(created.data.cover_label, 'MEMO')
  assert.equal(created.data.cover_text, '')
  const fields = { cover_url: '/journal-demo/lake.jpg', cover_label: '  我的随笔  ', cover_text: '  留住风景\n和那阵风  ' }
  assert.equal((await api('/notebooks/' + created.data.id, fields, 'PATCH')).status, 200)
  await initializeDatabase()
  let book = (await api('')).data.notebooks.find(book => book.id === created.data.id)
  assert.equal(book.cover_label, '我的随笔')
  assert.equal(book.cover_text, '留住风景\n和那阵风')
  assert.equal(book.cover_url, '/journal-demo/lake.jpg')
  assert.equal((await api('/notebooks/' + book.id, { cover_label: '', cover_text: '' }, 'PATCH')).status, 200)
  book = (await api('')).data.notebooks.find(book => book.id === created.data.id)
  assert.equal(book.cover_label, '')
  assert.equal(book.cover_text, '')
  for (const invalid of [{ cover_label: null }, { cover_label: 'a'.repeat(61) }, { cover_text: 23 }, { cover_text: 'a'.repeat(501) }]) {
    assert.equal((await api('/notebooks/' + book.id, invalid, 'PATCH')).status, 400)
  }
})
test('notebook pages and mixed placements persist and delete without deleting source records', async () => {
  const created = await api('/notebooks', { name: 'test notebook', canvas_x: 30, canvas_y: 80 })
  assert.equal(created.status, 201)
  const book = created.data
  books.push(book.id)
  let journal = (await api('')).data
  const pages = journal.notebook_pages.filter((p) => p.notebook_id === book.id)
  assert.equal(pages.length, 4)
  const mark = await api('/marks', { kind: 'text', text: 'keep me', canvas_x: 50, canvas_y: 60 })
  marks.push(mark.data.id)
  const entry = await api('/entries', { title: 'keep entry', photos: [] })
  entries.push(entry.data.id)
  const items = [
    { kind: 'mark', id: mark.data.id, x: 300, y: 400, rotation: 2 },
    { kind: 'entry', id: entry.data.id, x: 700, y: 800, rotation: 0 }
  ]
  assert.equal((await api(`/notebook-pages/${pages[0].id}/items`, { items })).status, 200)
  assert.equal(
    (
      await api(`/notebook-pages/${pages[1].id}/items`, {
        items: [items[0], { kind: 'mark', id: randomUUID(), x: 1, y: 1 }]
      })
    ).status,
    404
  )
  journal = (await api('')).data
  assert.equal(journal.notebook_items.find((i) => i.id === mark.data.id).page_id, pages[0].id)
  assert.equal(
    (await api(`/notebook-pages/${pages[1].id}/items`, { items: [{ ...items[0], x: 1201 }] })).status,
    400
  )
  assert.equal((await api('/notebook-items', { items: [{ ...items[0], x: 400 }] }, 'PATCH')).status, 200)
  assert.equal(
    (await api(`/notebooks/${book.id}/pages`, { page_ids: pages.map((p) => p.id).reverse() }, 'PATCH'))
      .status,
    200
  )
  assert.equal((await api(`/notebooks/${book.id}/pages`, { page_ids: [pages[0].id] }, 'PATCH')).status, 400)
  assert.equal(
    (await api('/notebooks/' + book.id, { name: 'renamed', cover_url: 'https://bad.example/x.png' }, 'PATCH'))
      .status,
    400
  )
  assert.equal((await api('/notebook-pages/' + pages[0].id, {}, 'DELETE')).status, 200)
  journal = (await api('')).data
  assert.equal(
    journal.notebook_items.some((i) => items.some((x) => x.id === i.id)),
    false
  )
  assert.equal(journal.marks.find((m) => m.id === mark.data.id).canvas_x, 50)
  assert.equal((await api('/notebook-pages/' + pages[1].id, {}, 'DELETE')).status, 200)
  assert.equal((await api('/notebook-pages/' + pages[2].id, {}, 'DELETE')).status, 400)
  assert.equal((await api('/notebooks/' + book.id, {}, 'DELETE')).status, 200)
  assert.ok((await api('')).data.entries.some((e) => e.id === entry.data.id))
})
test('direct imports reject missing pages atomically', async () => {
  const before = (await api('')).data
  assert.equal(
    (await api('/marks', { kind: 'text', text: 'rollback', notebook_page_id: randomUUID() })).status,
    404
  )
  assert.equal(
    (await api('/entries', { title: 'rollback', photos: [], notebook_page_id: randomUUID() })).status,
    404
  )
  const after = (await api('')).data
  assert.equal(after.entries.length, before.entries.length)
  assert.equal(after.marks.length, before.marks.length)
})

test('photo imports preserve retained membership, remove groups, and source deletion cascades', async () => {
  const b = await api('/notebooks', { name: 'photo import' })
  assert.equal(b.status, 201)
  books.push(b.data.id)
  const pages = (await api('')).data.notebook_pages.filter((p) => p.notebook_id === b.data.id)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=',
    'base64'
  )
  async function upload(page, entryId, retained = []) {
    const f = new FormData()
    f.append(
      'data',
      JSON.stringify({
        title: 'photo',
        photos: [...retained.map((id) => ({ id })), { upload_index: 0, canvas_x: 300, canvas_y: 400 }],
        notebook_page_id: page
      })
    )
    f.append('images', new Blob([png], { type: 'image/png' }), 'test.png')
    const r = await fetch(base + '/entries' + (entryId ? '/' + entryId : ''), {
      method: entryId ? 'PUT' : 'POST',
      body: f
    })
    return { status: r.status, data: await r.json() }
  }
  const bad = await upload(randomUUID())
  assert.equal(bad.status, 404)
  const made = await upload(pages[0].id)
  assert.equal(made.status, 201)
  entries.push(made.data.id)
  let j = (await api('')).data
  const photo = j.entries.find((e) => e.id === made.data.id).photos[0]
  assert.equal(j.notebook_items.find((i) => i.id === photo.id).x, 300)
  assert.equal(
    (
      await api(`/notebook-pages/${pages[0].id}/items`, {
        items: [{ kind: 'entry', id: made.data.id, x: 1, y: 1 }]
      })
    ).status,
    400
  )
  assert.equal((await upload(pages[1].id, made.data.id, [photo.id])).status, 200)
  j = (await api('')).data
  assert.equal(j.notebook_items.find((i) => i.id === photo.id).page_id, pages[0].id)
  const second = j.entries.find((e) => e.id === made.data.id).photos.find((p) => p.id !== photo.id)
  assert.equal(j.notebook_items.find((i) => i.id === second.id).page_id, pages[1].id)
  await api('/notebook-items', { items: [{ kind: 'photo', id: photo.id }] }, 'DELETE')
  const group = await api('/groups', { name: 'temp', positions: [{ id: photo.id, x: 10, y: 10 }] })
  assert.equal(group.status, 201)
  try {
    assert.equal(
      (
        await api(`/notebook-pages/${pages[0].id}/items`, {
          items: [{ kind: 'photo', id: photo.id, x: 300, y: 400 }]
        })
      ).status,
      200
    )
    const [[count]] = await pool.execute(
      'SELECT COUNT(*) AS n FROM journal_canvas_group_photos WHERE photo_id=?',
      [photo.id]
    )
    assert.equal(count.n, 0)
  } finally {
    await api('/groups/' + group.data.id, {}, 'DELETE')
  }
  await api('/photos/' + photo.id, {}, 'DELETE')
  j = (await api('')).data
  assert.equal(
    j.notebook_items.some((i) => i.id === photo.id),
    false
  )
  assert.equal((await api('/notebooks/' + b.data.id, { cover_url: second.url }, 'PATCH')).status, 200)
  await api('/photos/' + second.id, {}, 'DELETE')
  const { access } = await import('node:fs/promises')
  const { uploadDirectory } = await import('./app.js')
  const path = await import('node:path')
  await access(path.join(uploadDirectory, path.basename(second.url)))
})

test('page insertion, direct text/sticker creation and moves retain unique memberships', async () => {
  const made = await api('/notebooks', { name: 'direct marks' })
  assert.equal(made.status, 201)
  books.push(made.data.id)
  const initial = (await api('')).data.notebook_pages.filter((p) => p.notebook_id === made.data.id)
  const added = await api(`/notebooks/${made.data.id}/pages`, { after_id: initial[0].id })
  assert.equal(added.status, 201)
  let j = (await api('')).data
  assert.equal(
    j.notebook_pages
      .filter((p) => p.notebook_id === made.data.id)
      .sort((a, b) => a.sort_order - b.sort_order)[1].id,
    added.data.id
  )
  const mark = await api('/marks', {
    kind: 'sticker',
    sticker: 'flower',
    notebook_page_id: added.data.id,
    canvas_x: 500,
    canvas_y: 600
  })
  assert.equal(mark.status, 201)
  marks.push(mark.data.id)
  const entry = await api('/entries', { title: 'page text', photos: [], notebook_page_id: added.data.id })
  assert.equal(entry.status, 201)
  entries.push(entry.data.id)
  j = (await api('')).data
  assert.equal(j.notebook_items.find((i) => i.id === entry.data.id).x, 600)
  assert.equal(
    (
      await api(`/notebook-pages/${initial[0].id}/items`, {
        items: [{ kind: 'mark', id: mark.data.id, x: 20, y: 30 }]
      })
    ).status,
    200
  )
  j = (await api('')).data
  assert.equal(j.notebook_items.filter((i) => i.id === mark.data.id).length, 1)
  assert.equal(j.notebook_items.find((i) => i.id === mark.data.id).page_id, initial[0].id)
  await api('/marks/' + mark.data.id, {}, 'DELETE')
  assert.equal(
    (await api('')).data.notebook_items.some((i) => i.id === mark.data.id),
    false
  )
})
