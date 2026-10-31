// End-to-end network checks against private fixture media, never a personal DB.
import express from 'express'
import { chromium, expect } from '@playwright/test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import assert from 'node:assert/strict'
import { createPrivateImageHandler, getThumbnailPath } from '../server/thumbnails.js'

const directory = await mkdtemp(path.join(tmpdir(), 'footprint-thumb-smoke-'))
const image = await sharp(await readFile('public/journal-demo/wuzhen.jpg')).resize({ width: 2048 }).withMetadata().jpeg({ quality: 92 }).toBuffer()
for (const key of ['photo-a.jpg', 'photo-b.jpg']) await writeFile(path.join(directory, key), image)
const data = { trips: [], marks: [], notebooks: [], notebook_pages: [], notebook_items: [], canvas_groups: [], entries: [{ id: 'entry', entry_date: '2026-10-27', components: [], photos: ['a', 'b'].map((id, index) => ({ id: 'photo-' + id, url: `/uploads/photo-${id}.jpg`, canvas_absolute: 1, canvas_x: index * 600, canvas_y: 0, rotation: 0, components: [{ type: 'place', value: { name: index ? '杭州市' : '北京市' } }] })) }] }
const app = express()
app.get('/api/auth/session', (_req, res) => res.json({ user: { id: 'owner', email: 'fixture@example.com', email_verified: true }, csrfToken: 'fixture' }))
app.get('/api/journal', (_req, res) => res.json(data))
app.get('/api/landmarks', (_req, res) => res.json([]))
app.use('/uploads', (req, res, next) => req.get('x-fixture-user') === 'owner' ? next() : res.sendStatus(401), createPrivateImageHandler(directory, {
  authorize: async url => {
    if (!['/uploads/photo-a.jpg', '/uploads/photo-b.jpg'].includes(url)) throw Object.assign(new Error('missing'), { status: 404 })
    return path.basename(url)
  },
}))
app.use(express.static(path.resolve('dist')))
app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')))
const server = app.listen(0, '127.0.0.1')
await new Promise(resolve => server.once('listening', resolve))
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, extraHTTPHeaders: { 'x-fixture-user': 'owner' } })
  const requests = [], errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { const url = new URL(request.url()); if (url.pathname.startsWith('/uploads/')) requests.push(url.pathname + url.search) })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await expect(page.locator('.j-photo img')).toHaveCount(2)
  await expect.poll(() => page.locator('.j-photo img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 512))).toBe(true)
  assert.ok(requests.length > 0 && requests.every(url => url.endsWith('?thumbnail=1')), 'canvas must only request thumbnails')
  await page.getByRole('button', { name: '足迹版图', exact: true }).click()
  await expect(page.locator('.j-atlas-photo img')).toHaveCount(2)
  await expect.poll(() => page.locator('.j-atlas-photo img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth === 512))).toBe(true)
  assert.ok(requests.every(url => url.endsWith('?thumbnail=1')), 'atlas must not download large images before preview')
  await page.locator('[data-atlas-photo="photo-a"]').click()
  const full = page.locator('.j-viewer-photo img.j-viewer-original')
  await expect(full).toHaveAttribute('src', '/uploads/photo-a.jpg')
  await expect.poll(() => full.evaluate(image => image.naturalWidth)).toBe(2048)
  assert.deepEqual(requests.filter(url => !url.includes('?')), ['/uploads/photo-a.jpg'], 'preview must only fetch the selected original')
  await page.getByRole('button', { name: '下一张照片', exact: true }).click()
  await expect(full).toHaveAttribute('src', '/uploads/photo-b.jpg')
  await expect.poll(() => full.evaluate(image => image.naturalWidth)).toBe(2048)
  assert.deepEqual(requests.filter(url => !url.includes('?')), ['/uploads/photo-a.jpg', '/uploads/photo-b.jpg'])
  assert.deepEqual(errors, [])
  const thumbnail = await readFile(await getThumbnailPath(directory, 'photo-a.jpg'))
  assert.ok(thumbnail.length < image.length)
  console.log(JSON.stringify({ status: 'PASS', canvasAndAtlas: '512px thumbnails only', preview: 'only selected 2048px original', nextPhoto: 'loads next original on demand', fullBytes: image.length, thumbnailBytes: thumbnail.length }))
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  assert.ok(path.dirname(directory) === path.resolve(tmpdir()) && path.basename(directory).startsWith('footprint-thumb-smoke-'), 'Unsafe fixture cleanup')
  await rm(directory, { recursive: true, force: true })
}
