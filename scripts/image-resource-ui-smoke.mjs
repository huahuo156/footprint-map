// Synthetic API fixture only: this verifies browser integration, not real auth.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64')
const requests = [], errors = []
let releaseSession, sessionRequests = 0
const html = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ImageResourceProvider } from '/src/journal/images/ImageResourceProvider.jsx';
import JournalImage from '/src/journal/JournalImage.jsx';
import { clearApiSession } from '/src/lib/api.js';
const root = createRoot(document.getElementById('root'));
window.smoke = { reset: clearApiSession, render(mode = 'shared') {
  const shared = mode === 'shared' || mode === 'deleted';
  const children = shared ? ['one', 'two'].map(alt => React.createElement(JournalImage, { key: alt, src: '/uploads/test-shared.png', alt, loading: 'eager', resourcePolicy: 'canvas' })) : mode === 'bypass' ? [
    React.createElement(JournalImage, { key: 'full', src: '/uploads/test-full.png', alt: 'full', fullSize: true, loading: 'eager', resourcePolicy: 'canvas' }),
    React.createElement(JournalImage, { key: 'public', src: 'data:image/png;base64,${png.toString('base64')}', alt: 'public', loading: 'eager', resourcePolicy: 'canvas' })
  ] : [];
  root.render(React.createElement(ImageResourceProvider, { ownerId: 'synthetic-owner', mediaSources: mode === 'shared' ? ['/uploads/test-shared.png'] : [] }, children));
}, unmount() { root.unmount(); } };
window.smoke.render();
</script></body></html>`
const vite = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'image-resource-smoke-fixtures',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/__image_resources_test__') {
        res.setHeader('Content-Type', 'text/html')
        res.end(await server.transformIndexHtml(url.pathname, html))
      } else if (/^\/uploads\/test-[\w-]+\.png$/.test(url.pathname)) {
        requests.push(url.pathname + url.search)
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'private, no-store' })
        res.end(png)
      } else if (url.pathname === '/api/auth/session') {
        sessionRequests++
        releaseSession = () => {
          if (res.writableEnded || res.destroyed) return
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' })
          res.end(JSON.stringify({ user: { id: 'synthetic-owner' }, csrfToken: 'synthetic-only' }))
        }
      } else next()
    })
  },
}] })
let browser
const started = Date.now()
try {
  await vite.listen()
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined })
  const page = await browser.newPage()
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const address = vite.httpServer.address()
  await page.goto(`http://127.0.0.1:${address.port}/__image_resources_test__`)
  const ready = async name => {
    const image = page.locator(`img[alt="${name}"]`)
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true)
    return image.getAttribute('src')
  }
  const first = await ready('one')
  assert.match(first, /^blob:/)
  assert.equal(await ready('two'), first)
  assert.deepEqual(requests, ['/uploads/test-shared.png?thumbnail=1'])
  await page.evaluate(() => window.smoke.reset())
  await expect.poll(() => sessionRequests).toBe(1)
  await expect(page.locator('img')).toHaveCount(0)
  assert.equal(requests.length, 1, 'no private fallback while validation is held')
  releaseSession()
  const next = await ready('one')
  assert.notEqual(next, first)
  assert.equal(await ready('two'), next)
  assert.equal(requests.length, 2, 'new scope refetches once for both consumers')
  await page.evaluate(() => window.smoke.render('deleted'))
  await expect(page.locator('img')).toHaveCount(0)
  assert.equal(requests.length, 2, 'deleted source cannot keep or refetch stale pixels')
  await page.evaluate(() => window.smoke.render('bypass'))
  assert.equal(await ready('full'), '/uploads/test-full.png')
  assert.match(await ready('public'), /^data:/)
  assert.deepEqual(requests, ['/uploads/test-shared.png?thumbnail=1', '/uploads/test-shared.png?thumbnail=1', '/uploads/test-full.png'])
  await page.evaluate(() => window.smoke.unmount())
  await expect(page.locator('img')).toHaveCount(0)
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: ['shared fetch and decoded blob images', 'reset denies pixels until owner validation', 'new scope refetch', 'source deletion', 'full-size and public bypass', 'unmount'], mediaRequests: requests, sessionRequests, errors, elapsedMs: Date.now() - started, api: 'synthetic fixtures; no real auth or database' }, null, 2))
} finally {
  releaseSession?.()
  await browser?.close()
  await vite.close()
}
