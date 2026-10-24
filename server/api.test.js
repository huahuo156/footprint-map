import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { app, uploadDirectory } from './app.js'
import { pool, initializeDatabase } from './db.js'

let server, base
const checkins = [], guides = [], images = []
before(async () => {
  await initializeDatabase()
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  for (const id of checkins) {
    await pool.execute("DELETE FROM likes WHERE target_type='checkin' AND target_id=?", [id])
    await pool.execute('DELETE FROM checkins WHERE id=?', [id])
  }
  for (const id of guides) {
    await pool.execute("DELETE FROM likes WHERE target_type='guide' AND target_id=?", [id])
    await pool.execute('DELETE FROM guides WHERE id=?', [id])
  }
  for (const image of images) await unlink(path.join(uploadDirectory, path.basename(image))).catch(() => {})
  if (server) await new Promise(resolve => server.close(resolve))
  await pool.end()
})
async function request(route, data, method = 'POST') {
  const response = await fetch(base + route, data === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  return { status: response.status, data: await response.json() }
}
test('MySQL health and seeded landmarks work without a session', async () => {
  assert.equal((await request('/api/health')).data.database, 'mysql')
  const { data } = await request('/api/landmarks')
  assert.ok(data.length >= 293)
  assert.ok(data.some(row => row.name === '故宫博物院'))
  assert.equal(typeof data[0].lat, 'number')
})
test('upload, checkin, filters, text search, likes and persistence', async () => {
  const form = new FormData()
  form.append('image', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'test.png')
  const uploaded = await fetch(base + '/api/uploads/checkin-images', { method: 'POST', body: form })
  assert.equal(uploaded.status, 201)
  const { url } = await uploaded.json()
  images.push(url)
  assert.equal((await fetch(base + url)).status, 200)
  const caption = `integration-${Date.now()}`
  const created = await request('/api/checkins', { lat: 39.9, lng: 116.4, image_url: url, caption, province: '北京' })
  assert.equal(created.status, 201)
  checkins.push(created.data.id)
  const id = created.data.id
  assert.ok((await request('/api/checkins?province=北京&all=true')).data.some(row => row.id === id))
  assert.ok(!(await request('/api/checkins?province=上海')).data.some(row => row.id === id))
  assert.equal((await request('/api/search', { query: caption })).data.results[0].id, id)
  assert.equal((await request(`/api/likes/checkin/${id}`, {})).data.liked, true)
  assert.equal((await request(`/api/likes/checkin/${id}`)).data.liked, true)
  assert.equal((await request('/api/checkins?all=true')).data.find(row => row.id === id).likes_count, 1)
  assert.equal((await request(`/api/likes/checkin/${id}`, {})).data.liked, false)
  const [[stored]] = await pool.execute('SELECT caption, likes_count FROM checkins WHERE id=?', [id])
  assert.equal(stored.caption, caption)
  assert.equal(stored.likes_count, 0)
})
test('personal guide content works without a profile or author identity', async () => {
  const created = await request('/api/guides', { title: '集成测试攻略', content: '中文攻略', province: '浙江', landmark_ids: [1] })
  assert.equal(created.status, 201)
  guides.push(created.data.id)
  const detail = await request(`/api/guides/${created.data.id}`)
  assert.deepEqual(detail.data.landmark_ids, [1])
  assert.equal(detail.data.content, '中文攻略')
  assert.equal(Object.hasOwn(detail.data, 'profiles'), false)
  assert.equal((await request('/api/profile')).status, 404)
  assert.equal((await request('/api/profile', { nickname: 'unused' }, 'PUT')).status, 404)
})
test('invalid input and nonexistent targets return appropriate errors', async () => {
  assert.equal((await request('/api/guides', { title: '' })).status, 400)
  assert.equal((await request('/api/checkins', { lat: 100, lng: 0 })).status, 400)
  assert.equal((await request('/api/checkins?limit=-1')).status, 400)
  assert.equal((await request('/api/likes/invalid/1', {})).status, 400)
  assert.equal((await request('/api/likes/guide/2147483647', {})).status, 404)
  const form = new FormData()
  form.append('image', new Blob(['hello'], { type: 'text/plain' }), 'test.txt')
  assert.equal((await fetch(base + '/api/uploads/avatars', { method: 'POST', body: form })).status, 400)
})
