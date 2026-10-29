// Browser regression against isolated API fixtures; never accesses the real DB.
import express from 'express'
import { chromium, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'

const app = express(), root = path.resolve('dist')
app.use(express.static(root))
app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'index.html')))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
const output = path.resolve('test-results/canvas-collision')
await mkdir(output, { recursive: true })
const data = {
  trips: [],
  entries: [{ id: 'e', entry_date: '2026-10-27', components: [], photos: ['p', 'q'].map((id, index) => ({ id, url: '/journal-demo/wuzhen.jpg', components: [], canvas_absolute: 1, canvas_x: index * 300, canvas_y: index * 200, rotation: 0 })) }, { id: 'loose-entry', entry_date: '2026-10-27', components: [], photos: [{ id: 'loose', url: '/journal-demo/wuzhen.jpg', components: [], canvas_absolute: 1, canvas_x: -700, canvas_y: 0, rotation: 0 }] }],
  marks: [{ id: 'sticker', kind: 'sticker', sticker: 'flower', size: 'large', color: 'sage', canvas_x: 700, canvas_y: 0, rotation: 0, captured_on: '2026-10-27' }, { id: 'text', kind: 'text', text: '文字也会自动避让', size: 'medium', color: 'sage', canvas_x: 700, canvas_y: 400, rotation: 0, captured_on: '2026-10-27' }],
  canvas_groups: [{ id: 'g', name: '回忆', photo_ids: ['p', 'q'], collapsed: true, color: 'lavender' }],
  notebooks: [{ id: 'book', name: '保研之旅', canvas_x: 0, canvas_y: 0, cover_mode: 'solid', cover_color: '#283c32' }], notebook_items: [], notebook_pages: [],
}
let writes = 0
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()).pathname
    if (url.startsWith('/api/auth/')) return route.fulfill({ json: { user: { id: 'collision-user', email: 'test@example.com', email_verified: true }, csrfToken: 'fixture' } })
    if (url === '/api/journal' && request.method() === 'GET') return route.fulfill({ json: data })
    if (url === '/api/journal/layout') {
      writes++
      for (const item of request.postDataJSON().items) {
        const value = item.kind === 'mark' ? data.marks.find(mark => mark.id === item.id) : data.entries.flatMap(entry => entry.photos).find(photo => photo.id === item.id)
        Object.assign(value, { canvas_x: item.x, canvas_y: item.y, rotation: item.rotation, ...(item.kind === 'photo' ? { canvas_absolute: 1 } : {}) })
      }
      return route.fulfill({ json: { ok: true } })
    }
    if (url === '/api/journal/notebooks/book') {
      writes++; Object.assign(data.notebooks[0], request.postDataJSON())
      return route.fulfill({ json: data.notebooks[0] })
    }
    if (url === '/api/journal/groups/g') {
      writes++
      const { positions = [], ...values } = request.postDataJSON()
      Object.assign(data.canvas_groups[0], values)
      for (const p of positions) Object.assign(data.entries[0].photos.find(photo => photo.id === p.id), { canvas_x: p.x, canvas_y: p.y })
      return route.fulfill({ json: data.canvas_groups[0] })
    }
    throw new Error(`Unexpected fixture API request: ${request.method()} ${url}`)
  })
  await page.addInitScript(() => localStorage.setItem('shitu-camera-v1:collision-user', JSON.stringify({ x: 0, y: 0, scale: .7, detail: true })))
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const cover = page.locator('[data-notebook-id="book"]'), group = page.locator('[data-group-id="g"]'), sticker = page.locator('[data-photo-id="sticker"]')
  await cover.waitFor()
  const center = box => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
  const separate = async () => {
    await expect.poll(async () => {
      const a = await cover.boundingBox(), b = await group.boundingBox()
      return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
    }, { message: 'cover and group must not overlap after settling' }).toBe(true)
  }
  async function dragTo(locator, target, relative = { x: .5, y: .5 }) {
    const bounds = await locator.boundingBox()
    await page.mouse.move(bounds.x + bounds.width * relative.x, bounds.y + bounds.height * relative.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 10 })
    await page.mouse.up()
    await page.waitForFunction(() => !document.querySelector('.j-canvas-controls')?.textContent.includes('正在保存'))
  }
  await separate()
  assert.ok(writes >= 1, 'initial overlap repair must be saved')
  const membersBefore = structuredClone(data.entries[0].photos)
  await dragTo(cover, center(await group.boundingBox()))
  await separate()
  assert.deepEqual(data.entries[0].photos, membersBefore, 'dragging notebook must leave group fixed')
  const bookBefore = structuredClone(data.notebooks[0])
  await dragTo(page.getByRole('button', { name: '移动分组：回忆', exact: true }), center(await cover.boundingBox()), { x: .2, y: .5 })
  await separate()
  assert.deepEqual(data.notebooks[0], bookBefore, 'dragging group must leave notebook fixed')
  assert.equal(data.entries[0].photos[1].canvas_x - data.entries[0].photos[0].canvas_x, 300)
  assert.equal(data.entries[0].photos[1].canvas_y - data.entries[0].photos[0].canvas_y, 200)
  const unchangedBook = structuredClone(data.notebooks[0])
  for (const id of ['loose', 'text']) {
    const content = page.locator(`[data-photo-id="${id}"]`)
    await dragTo(content, center(await cover.boundingBox()))
    await expect.poll(async () => {
      const a = await content.boundingBox(), b = await cover.boundingBox()
      return a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
    }).toBe(true)
    assert.deepEqual(data.notebooks[0], unchangedBook, 'photo and text drops must leave notebook fixed')
  }
  await dragTo(sticker, center(await cover.boundingBox()))
  const a = center(await sticker.boundingBox()), b = center(await cover.boundingBox())
  assert.ok(Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2, 'sticker must stay at its requested overlapping location')
  await page.getByRole('button', { name: '展开分组：回忆', exact: true }).click()
  await page.getByRole('button', { name: '折叠分组：回忆', exact: true }).waitFor()
  await separate()
  const saved = structuredClone(data), writesBefore = writes
  await page.reload(); await cover.waitFor(); await separate()
  assert.deepEqual(data, saved, 'reload must retain persisted positions')
  assert.equal(writes, writesBefore, 'reload must not cause another repair')
  await page.screenshot({ path: path.join(output, 'canvas.png') })
  assert.deepEqual(errors, [])
  console.log('PASS: repair, notebook/photo/text drag, rigid group drag, sticker overlap, expansion, persisted reload; screenshot: ' + path.join(output, 'canvas.png'))
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
}
